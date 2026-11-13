import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common'
import { z } from 'zod'
import { AuditService } from '../audit/audit.service'
import { CurrentUser, Staff, type AuthUser } from '../common/auth.decorators'
import { fail, notFound } from '../common/errors'
import { ZodPipe } from '../common/zod.pipe'
import { NotificationsService } from '../notifications/notifications.service'
import { APPROVED } from '../orders/order-rules'
import { adminOrderInclude, toAdminOrder } from '../orders/order.mapper'
import { orderStatusSchema, orderTypeSchema } from '../orders/order-schemas'
import { PrismaService } from '../prisma/prisma.service'
import { AdminOrdersService } from './admin-orders.service'

const platform = z.enum(['YOUTUBE', 'INSTAGRAM'])

const listOrdersQuery = z.object({
  types: z
    .string()
    .transform((value) => value.split(','))
    .pipe(z.array(orderTypeSchema).min(1)),
  status: orderStatusSchema.optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})
const statusBody = z.object({
  status: orderStatusSchema,
  note: z.string().trim().max(500).optional(),
  rejectionReason: z.string().trim().max(500).optional(),
  force: z.boolean().optional(),
})
const deliveriesBody = z.object({ emailIds: z.array(z.string().min(1)).max(10_000) })
const createEmailBody = z.object({
  address: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  platforms: z.array(platform).min(1, 'Choose at least one platform.'),
})
const patchEmailBody = z.object({ platforms: z.array(platform).optional(), active: z.boolean().optional() })
const usersQuery = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  q: z.string().trim().max(100).optional(),
})
const patchUserBody = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) })
const notifyBody = z.object({
  audience: z.string().min(1),
  title: z.string().trim().min(2, 'Add a title.').max(120),
  body: z.string().trim().min(2, 'Write a message.').max(2000),
  sendEmail: z.boolean().default(false),
})

@Staff()
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: AdminOrdersService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // ── Orders ──
  @Get('summary')
  async summary() {
    return { pendingByType: await this.orders.pendingCounts() }
  }

  @Get('orders')
  listOrders(@Query(new ZodPipe(listOrdersQuery)) query: z.infer<typeof listOrdersQuery>) {
    return this.orders.list(query)
  }

  @Get('orders/:id')
  getOrder(@Param('id') id: string) {
    return this.orders.get(id)
  }

  @Post('orders/:id/status')
  setStatus(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(statusBody)) body: z.infer<typeof statusBody>) {
    return this.orders.setStatus(user.userId, id, body)
  }

  @Put('orders/:id/deliveries')
  setDeliveries(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(deliveriesBody)) body: z.infer<typeof deliveriesBody>) {
    return this.orders.setDeliveries(user.userId, id, body.emailIds)
  }

  // ── Delivery emails ──
  @Get('delivery-emails')
  async listEmails() {
    const emails = await this.prisma.deliveryEmail.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        deliveries: {
          orderBy: { createdAt: 'desc' },
          select: { order: { select: { id: true, ref: true, type: true, target: true, status: true } } },
        },
      },
    })
    return {
      items: emails.map(({ deliveries, ...email }) => ({ ...email, usage: deliveries.map((delivery) => delivery.order) })),
    }
  }

  @Post('delivery-emails')
  async createEmail(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createEmailBody)) body: z.infer<typeof createEmailBody>) {
    if (await this.prisma.deliveryEmail.findUnique({ where: { address: body.address } })) {
      fail(HttpStatus.CONFLICT, 'EMAIL_EXISTS', 'That email is already in the list.', { address: 'Already added.' })
    }
    const email = await this.prisma.deliveryEmail.create({ data: { address: body.address, platforms: [...new Set(body.platforms)] } })
    await this.audit.log(user.userId, 'deliveryEmail.create', 'DeliveryEmail', email.id)
    return { ...email, usage: [] }
  }

  @Patch('delivery-emails/:id')
  async patchEmail(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(patchEmailBody)) body: z.infer<typeof patchEmailBody>) {
    const email = await this.prisma.deliveryEmail.update({
      where: { id },
      data: { ...body, ...(body.platforms ? { platforms: [...new Set(body.platforms)] } : {}) },
    })
    await this.audit.log(user.userId, 'deliveryEmail.update', 'DeliveryEmail', id, body)
    return email
  }

  @HttpCode(204)
  @Delete('delivery-emails/:id')
  async deleteEmail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (await this.prisma.delivery.count({ where: { deliveryEmailId: id } })) {
      fail(HttpStatus.CONFLICT, 'EMAIL_IN_USE', 'This email was used for orders. Turn it off instead of deleting it.')
    }
    await this.prisma.deliveryEmail.delete({ where: { id } })
    await this.audit.log(user.userId, 'deliveryEmail.delete', 'DeliveryEmail', id)
  }

  // ── Users ──
  @Get('users')
  async listUsers(@Query(new ZodPipe(usersQuery)) query: z.infer<typeof usersQuery>) {
    const users = await this.prisma.user.findMany({
      where: {
        role: 'CUSTOMER',
        ...(query.status ? { status: query.status } : {}),
        ...(query.q
          ? { OR: [{ email: { contains: query.q, mode: 'insensitive' } }, { name: { contains: query.q, mode: 'insensitive' } }] }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { id: true, name: true, email: true, phone: true, role: true, status: true, createdAt: true, _count: { select: { orders: true } } },
    })
    const spend = await this.prisma.order.groupBy({
      by: ['userId'],
      where: { userId: { in: users.map((user) => user.id) }, status: { in: APPROVED } },
      _sum: { amountEtb: true },
    })
    const spendByUser = new Map(spend.map((row) => [row.userId, row._sum.amountEtb ?? 0]))
    const counts = { ALL: 0, ACTIVE: 0, SUSPENDED: 0 }
    for (const row of await this.prisma.user.groupBy({ by: ['status'], where: { role: 'CUSTOMER' }, _count: { _all: true } })) {
      counts[row.status] = row._count._all
      counts.ALL += row._count._all
    }
    return {
      counts,
      items: users.map(({ _count, ...user }) => ({ ...user, orderCount: _count.orders, approvedSpendEtb: spendByUser.get(user.id) ?? 0 })),
    }
  }

  @Get('users/:id/orders')
  async userOrders(@Param('id') id: string) {
    const orders = await this.prisma.order.findMany({ where: { userId: id }, include: adminOrderInclude, orderBy: { createdAt: 'desc' } })
    return { items: orders.map(toAdminOrder) }
  }

  @Patch('users/:id')
  async patchUser(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body(new ZodPipe(patchUserBody)) body: z.infer<typeof patchUserBody>) {
    if (id === actor.userId) fail(HttpStatus.BAD_REQUEST, 'SELF', 'You cannot change your own account status.')
    const target = await this.prisma.user.findUnique({ where: { id } })
    if (!target) return notFound('User')
    if (target.role !== 'CUSTOMER') fail(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Staff accounts are managed under Team.')

    const user = await this.prisma.user.update({ where: { id }, data: { status: body.status } })
    if (body.status === 'SUSPENDED') {
      await this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } })
    }
    await this.audit.log(actor.userId, 'user.status', 'User', id, body)
    return { id: user.id, status: user.status }
  }

  // ── Notifications ──
  @Get('notifications')
  async listNotifications(@Query('kind', new ZodPipe(z.enum(['MANUAL', 'ORDER_UPDATE']).optional())) kind?: 'MANUAL' | 'ORDER_UPDATE') {
    const batches = await this.prisma.notificationBatch.findMany({
      where: kind ? { kind } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    const userIds = [...new Set(batches.map((batch) => batch.audience).filter((audience) => audience !== 'all'))]
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
    const byId = new Map(users.map((user) => [user.id, user]))
    const counts = await this.prisma.notificationBatch.groupBy({ by: ['kind'], _count: { _all: true } })
    return {
      counts: Object.fromEntries(counts.map((row) => [row.kind, row._count._all])),
      items: batches.map((batch) => ({
        ...batch,
        audienceUser: batch.audience === 'all' ? null : (byId.get(batch.audience) ?? null),
      })),
    }
  }

  @Post('notifications')
  async sendNotification(@CurrentUser() user: AuthUser, @Body(new ZodPipe(notifyBody)) body: z.infer<typeof notifyBody>) {
    if (body.audience !== 'all' && !(await this.prisma.user.findUnique({ where: { id: body.audience } }))) {
      fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'That user no longer exists.', { audience: 'Choose a user.' })
    }
    const batch = await this.notifications.send({
      kind: 'MANUAL',
      audience: body.audience,
      title: body.title,
      body: body.body,
      createdById: user.userId,
      email: body.sendEmail,
    })
    await this.audit.log(user.userId, 'notification.send', 'NotificationBatch', batch.id, { audience: body.audience })
    return batch
  }

  @HttpCode(204)
  @Delete('notifications/:id')
  async deleteNotification(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.prisma.notificationBatch.delete({ where: { id } })
    await this.audit.log(user.userId, 'notification.delete', 'NotificationBatch', id)
  }
}
