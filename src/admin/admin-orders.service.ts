import { HttpStatus, Injectable } from '@nestjs/common'
import { Prisma, type Order, type OrderStatus, type OrderType, type Platform } from '@prisma/client'
import { AuditService } from '../audit/audit.service'
import { fail, notFound } from '../common/errors'
import { NotificationsService } from '../notifications/notifications.service'
import { APPROVED, DELIVERY_PLATFORM, STATUS_LABEL, TYPE_LABEL, canTransition } from '../orders/order-rules'
import { adminOrderInclude, toAdminOrder } from '../orders/order.mapper'
import { PrismaService } from '../prisma/prisma.service'

type ListQuery = { types: OrderType[]; status?: OrderStatus; q?: string; page: number; pageSize: number }
type StatusInput = { status: OrderStatus; note?: string; rejectionReason?: string; force?: boolean }

@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async list({ types, status, q, page, pageSize }: ListQuery) {
    const search: Prisma.OrderWhereInput = q
      ? {
          OR: [
            { ref: { contains: q, mode: 'insensitive' } },
            { target: { contains: q, mode: 'insensitive' } },
            { user: { email: { contains: q, mode: 'insensitive' } } },
            { user: { name: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}
    const scope: Prisma.OrderWhereInput = { type: { in: types }, ...search }
    const where: Prisma.OrderWhereInput = { ...scope, ...(status ? { status } : {}) }

    const [items, total, grouped, revenue] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: adminOrderInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
      this.prisma.order.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
      this.prisma.order.aggregate({ where: { ...scope, status: { in: APPROVED } }, _sum: { amountEtb: true } }),
    ])

    const counts: Record<OrderStatus | 'ALL', number> = { ALL: 0, PENDING: 0, ACCEPTED: 0, IN_PROGRESS: 0, COMPLETED: 0, REJECTED: 0 }
    for (const row of grouped) {
      counts[row.status] = row._count._all
      counts.ALL += row._count._all
    }
    return { items: items.map(toAdminOrder), total, page, pageSize, counts, revenueEtb: revenue._sum.amountEtb ?? 0 }
  }

  async pendingCounts() {
    const rows = await this.prisma.order.groupBy({ by: ['type'], where: { status: 'PENDING' }, _count: { _all: true } })
    return Object.fromEntries(rows.map((row) => [row.type, row._count._all]))
  }

  async setStatus(actorId: string, id: string, input: StatusInput) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { _count: { select: { deliveries: true } } } })
    if (!order) return notFound('Order')
    if (order.status === input.status) return this.get(id)

    if (!canTransition(order.status, input.status)) {
      fail(HttpStatus.CONFLICT, 'INVALID_TRANSITION', `An order that is ${STATUS_LABEL[order.status]} cannot move to ${STATUS_LABEL[input.status]}.`)
    }
    if (input.status === 'REJECTED' && !input.rejectionReason?.trim()) {
      fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'Add a reason for the customer.', { rejectionReason: 'Required when rejecting.' })
    }
    const deliverable = DELIVERY_PLATFORM[order.type] && order.quantity
    if (input.status === 'COMPLETED' && deliverable && order._count.deliveries < order.quantity! && !input.force) {
      fail(
        HttpStatus.CONFLICT,
        'NOT_FULLY_DELIVERED',
        `Only ${order._count.deliveries} of ${order.quantity} delivered. Assign the remaining emails or confirm completion anyway.`,
      )
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: {
          status: input.status,
          rejectionReason: input.status === 'REJECTED' ? input.rejectionReason!.trim() : null,
        },
      })
      await tx.orderEvent.create({
        data: { orderId: id, from: order.status, to: input.status, actorId, note: input.note?.trim() || input.rejectionReason?.trim() },
      })
      await this.applyMarketplaceEffects(tx, order, input.status)
    })

    const reason = input.status === 'REJECTED' ? ` Reason: ${input.rejectionReason!.trim()}` : ''
    await this.notifications.send({
      kind: 'ORDER_UPDATE',
      audience: order.userId,
      title: `Order ${order.ref} is ${STATUS_LABEL[input.status]}`,
      body: `Your ${TYPE_LABEL[order.type].toLowerCase()} order for ${order.target} is now ${STATUS_LABEL[input.status]}.${reason}`,
      orderId: order.id,
      createdById: actorId,
      email: true,
    })
    await this.audit.log(actorId, 'order.status', 'Order', id, { from: order.status, to: input.status, force: input.force ?? false })
    return this.get(id)
  }

  /**
   * Account orders change the marketplace:
   * - completing a purchase marks the listing SOLD (reopening puts it back on sale);
   * - completing a sale request publishes the seller's account as a listing (reopening archives it).
   */
  private async applyMarketplaceEffects(tx: Prisma.TransactionClient, order: Order, to: OrderStatus) {
    const completing = to === 'COMPLETED'
    const reopening = order.status === 'COMPLETED'
    if (!completing && !reopening) return

    if (order.type === 'ACCOUNT_PURCHASE' && order.listingId) {
      await tx.listing.update({ where: { id: order.listingId }, data: { status: completing ? 'SOLD' : 'PUBLISHED' } })
    }

    if (order.type === 'ACCOUNT_SALE') {
      if (reopening && order.listingId) {
        await tx.listing.update({ where: { id: order.listingId }, data: { status: 'ARCHIVED' } })
      } else if (completing) {
        const details = (order.details ?? {}) as Record<string, string>
        const data = {
          platform: (details.platform ?? 'YOUTUBE') as Platform,
          name: details.name ?? order.target,
          profileUrl: order.target,
          audience: details.audience ?? '—',
          includes: '1 account',
          priceEtb: order.amountEtb,
          status: 'PUBLISHED' as const,
        }
        if (order.listingId) {
          await tx.listing.update({ where: { id: order.listingId }, data })
        } else {
          const listing = await tx.listing.create({ data: { ...data, sellerId: order.userId } })
          await tx.order.update({ where: { id: order.id }, data: { listingId: listing.id } })
        }
      }
    }
  }

  /** Replaces the set of emails that subscribed/followed for a delivery order. */
  async setDeliveries(actorId: string, id: string, emailIds: string[]) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { deliveries: true } })
    if (!order) return notFound('Order')
    const platform = DELIVERY_PLATFORM[order.type]
    if (!platform || !order.quantity) fail(HttpStatus.BAD_REQUEST, 'NOT_DELIVERABLE', 'This order type does not use delivery emails.')
    if (order.status === 'REJECTED') fail(HttpStatus.CONFLICT, 'ORDER_REJECTED', 'Rejected orders cannot be delivered.')

    const ids = [...new Set(emailIds)]
    if (ids.length > order.quantity) fail(HttpStatus.BAD_REQUEST, 'OVER_TARGET', `This order only needs ${order.quantity} emails.`)

    const current = new Set(order.deliveries.map((delivery) => delivery.deliveryEmailId))
    const added = ids.filter((emailId) => !current.has(emailId))

    if (added.length) {
      const emails = await this.prisma.deliveryEmail.findMany({ where: { id: { in: added } } })
      if (emails.length !== added.length) fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'One or more emails no longer exist.')
      const invalid = emails.filter((email) => !email.active || !email.platforms.includes(platform))
      if (invalid.length) {
        fail(HttpStatus.CONFLICT, 'EMAIL_UNAVAILABLE', `Not usable for this platform or inactive: ${invalid.map((e) => e.address).join(', ')}`)
      }
      const used = await this.prisma.delivery.findMany({
        where: { platform, targetNormalized: order.targetNormalized, deliveryEmailId: { in: added }, orderId: { not: id } },
        include: { email: true },
      })
      if (used.length) {
        fail(HttpStatus.CONFLICT, 'ALREADY_USED', `Already used for this target: ${used.map((d) => d.email.address).join(', ')}`)
      }
    }

    try {
      await this.prisma.$transaction([
        this.prisma.delivery.deleteMany({ where: { orderId: id, deliveryEmailId: { notIn: ids } } }),
        this.prisma.delivery.createMany({
          data: added.map((deliveryEmailId) => ({
            orderId: id,
            deliveryEmailId,
            platform,
            targetNormalized: order.targetNormalized,
            createdById: actorId,
          })),
        }),
      ])
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        fail(HttpStatus.CONFLICT, 'ALREADY_USED', 'One of these emails was just used for this target. Refresh and try again.')
      }
      throw error
    }
    await this.audit.log(actorId, 'order.deliveries', 'Order', id, { count: ids.length })
    return this.get(id)
  }

  async get(id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: adminOrderInclude })
    return order ? toAdminOrder(order) : notFound('Order')
  }
}
