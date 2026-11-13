import { Controller, Get, Query } from '@nestjs/common'
import type { OrderStatus, OrderType } from '@prisma/client'
import { z } from 'zod'
import { Staff } from '../common/auth.decorators'
import { ZodPipe } from '../common/zod.pipe'
import { APPROVED } from '../orders/order-rules'
import { PrismaService } from '../prisma/prisma.service'

const DAY = 86_400_000
const overviewQuery = z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d)).default(30) })
const auditQuery = z.object({
  entity: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

const isApproved = (status: OrderStatus) => APPROVED.includes(status)
const dayKey = (date: Date) => date.toISOString().slice(0, 10)

@Staff()
@Controller('admin')
export class AdminOverviewController {
  constructor(private readonly prisma: PrismaService) {}

  /** Everything the dashboard overview needs, for the last `days` days compared with the period before. */
  @Get('overview')
  async overview(@Query(new ZodPipe(overviewQuery)) { days }: z.infer<typeof overviewQuery>) {
    const now = new Date()
    const start = new Date(now.getTime() - days * DAY)
    const previousStart = new Date(start.getTime() - days * DAY)

    const [
      windowOrders,
      byType,
      byStatus,
      lifetimeRevenue,
      customers,
      newCustomers,
      previousNewCustomers,
      recentOrders,
      topSpenders,
      pool,
      activeEmails,
      deliveries,
      activity,
      listings,
    ] = await Promise.all([
      this.prisma.order.findMany({
        where: { createdAt: { gte: previousStart } },
        select: { createdAt: true, amountEtb: true, status: true, type: true },
      }),
      this.prisma.order.groupBy({ by: ['type', 'status'], _count: { _all: true }, _sum: { amountEtb: true } }),
      this.prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.order.aggregate({ where: { status: { in: APPROVED } }, _sum: { amountEtb: true } }),
      this.prisma.user.count({ where: { role: 'CUSTOMER' } }),
      this.prisma.user.count({ where: { role: 'CUSTOMER', createdAt: { gte: start } } }),
      this.prisma.user.count({ where: { role: 'CUSTOMER', createdAt: { gte: previousStart, lt: start } } }),
      this.prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: 7,
        select: {
          id: true,
          ref: true,
          type: true,
          status: true,
          target: true,
          amountEtb: true,
          createdAt: true,
          details: true,
          listing: { select: { name: true } },
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.order.groupBy({
        by: ['userId'],
        where: { status: { in: APPROVED } },
        _sum: { amountEtb: true },
        _count: { _all: true },
        orderBy: { _sum: { amountEtb: 'desc' } },
        take: 5,
      }),
      this.prisma.deliveryEmail.count(),
      this.prisma.deliveryEmail.count({ where: { active: true } }),
      this.prisma.delivery.count(),
      this.recentActivity(8),
      this.prisma.listing.groupBy({ by: ['status'], _count: { _all: true } }),
    ])

    // ── Period KPIs + daily series ──
    const current = windowOrders.filter((order) => order.createdAt >= start)
    const previous = windowOrders.filter((order) => order.createdAt < start)
    const sumApproved = (rows: typeof windowOrders) =>
      rows.reduce((sum, row) => sum + (isApproved(row.status) ? row.amountEtb : 0), 0)
    const completedShare = (rows: typeof windowOrders) => {
      const decided = rows.filter((row) => row.status === 'COMPLETED' || row.status === 'REJECTED')
      return decided.length ? rows.filter((row) => row.status === 'COMPLETED').length / decided.length : 0
    }

    const series = new Map<string, { date: string; orders: number; revenueEtb: number }>()
    for (let index = days - 1; index >= 0; index--) {
      const date = dayKey(new Date(now.getTime() - index * DAY))
      series.set(date, { date, orders: 0, revenueEtb: 0 })
    }
    for (const order of current) {
      const bucket = series.get(dayKey(order.createdAt))
      if (!bucket) continue
      bucket.orders += 1
      if (isApproved(order.status)) bucket.revenueEtb += order.amountEtb
    }

    // ── Breakdown by service ──
    const types: OrderType[] = ['YOUTUBE_SUBSCRIBERS', 'INSTAGRAM_FOLLOWERS', 'ACCOUNT_PURCHASE', 'ACCOUNT_SALE']
    const services = types.map((type) => {
      const rows = byType.filter((row) => row.type === type)
      return {
        type,
        orders: rows.reduce((sum, row) => sum + row._count._all, 0),
        pending: rows.find((row) => row.status === 'PENDING')?._count._all ?? 0,
        // Account sales are payouts to sellers, not income.
        revenueEtb:
          type === 'ACCOUNT_SALE'
            ? 0
            : rows.filter((row) => isApproved(row.status)).reduce((sum, row) => sum + (row._sum.amountEtb ?? 0), 0),
      }
    })

    const statusCounts: Record<OrderStatus, number> = { PENDING: 0, ACCEPTED: 0, IN_PROGRESS: 0, COMPLETED: 0, REJECTED: 0 }
    for (const row of byStatus) statusCounts[row.status] = row._count._all

    const spenders = await this.prisma.user.findMany({
      where: { id: { in: topSpenders.map((row) => row.userId) } },
      select: { id: true, name: true, email: true },
    })
    const spenderById = new Map(spenders.map((user) => [user.id, user]))

    return {
      days,
      kpis: {
        revenueEtb: { current: sumApproved(current), previous: sumApproved(previous) },
        orders: { current: current.length, previous: previous.length },
        newCustomers: { current: newCustomers, previous: previousNewCustomers },
        completionRate: { current: completedShare(current), previous: completedShare(previous) },
      },
      totals: {
        lifetimeRevenueEtb: lifetimeRevenue._sum.amountEtb ?? 0,
        customers,
        pending: statusCounts.PENDING,
        inFlight: statusCounts.ACCEPTED + statusCounts.IN_PROGRESS,
      },
      series: [...series.values()],
      services,
      statusCounts,
      recentOrders: recentOrders.map(({ listing, details, ...order }) => ({
        ...order,
        title: listing?.name ?? (details as Record<string, string> | null)?.name ?? order.target,
      })),
      topCustomers: topSpenders.map((row) => ({
        user: spenderById.get(row.userId) ?? { id: row.userId, name: 'Deleted user', email: '' },
        orders: row._count._all,
        spentEtb: row._sum.amountEtb ?? 0,
      })),
      deliveryPool: { total: pool, active: activeEmails, deliveries },
      listings: Object.fromEntries(listings.map((row) => [row.status, row._count._all])),
      activity,
    }
  }

  @Get('audit')
  async audit(@Query(new ZodPipe(auditQuery)) { entity, page, pageSize }: z.infer<typeof auditQuery>) {
    const where = entity ? { entity } : {}
    const [total, items] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.recentActivity(pageSize, (page - 1) * pageSize, where),
    ])
    return { items, total, page, pageSize }
  }

  /** Audit rows joined with the acting staff member and a readable label for the entity. */
  private async recentActivity(take: number, skip = 0, where: { entity?: string } = {}) {
    const rows = await this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip })
    const actorIds = [...new Set(rows.map((row) => row.actorId))]
    const orderIds = rows.filter((row) => row.entity === 'Order').map((row) => row.entityId)
    const userIds = rows.filter((row) => row.entity === 'User').map((row) => row.entityId)
    const [actors, orders, users] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true, role: true } }),
      this.prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, ref: true } }),
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    ])
    const actorById = new Map(actors.map((actor) => [actor.id, actor]))
    const labels = new Map<string, string>([
      ...orders.map((order) => [order.id, order.ref] as [string, string]),
      ...users.map((user) => [user.id, user.name] as [string, string]),
    ])
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      entity: row.entity,
      entityId: row.entityId,
      entityLabel: labels.get(row.entityId) ?? null,
      data: row.data,
      createdAt: row.createdAt,
      actor: actorById.get(row.actorId) ?? null,
    }))
  }
}
