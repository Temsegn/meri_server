import { HttpStatus, Injectable } from '@nestjs/common'
import type { Subscription, SubscriptionPayMethod, SubscriptionPlan } from '@prisma/client'
import { fail, notFound } from '../common/errors'
import { NotificationsService } from '../notifications/notifications.service'
import { PrismaService } from '../prisma/prisma.service'

/** Meri Premium plans. Only these two are sold. */
export const PLANS: Record<SubscriptionPlan, { label: string; months: number; amountEtb: number }> = {
  SIX_MONTHS: { label: '6 months', months: 6, amountEtb: 380 },
  ONE_YEAR: { label: '1 year', months: 12, amountEtb: 600 },
}

/** Where customers send money. Shown in the app; admins match receipts against these. */
export const PAYMENT_ACCOUNTS: Record<SubscriptionPayMethod, { name: string; account: string; holder: string }> = {
  TELEBIRR: { name: 'telebirr', account: '9992327207', holder: 'Meri' },
  CBE: { name: 'Commercial Bank of Ethiopia (CBE)', account: '1000301250537', holder: 'Meri' },
  ABYSSINIA: { name: 'Bank of Abyssinia', account: '247682187', holder: 'Meri' },
}

const addMonths = (d: Date, months: number) => {
  const out = new Date(d)
  out.setMonth(out.getMonth() + months)
  return out
}

export const subscriptionView = (s: Subscription) => ({
  id: s.id,
  plan: s.plan,
  planLabel: PLANS[s.plan].label,
  amountEtb: s.amountEtb,
  method: s.method,
  status: s.status,
  rejectionReason: s.rejectionReason,
  receiptFileId: s.receiptFileId,
  startsAt: s.startsAt,
  endsAt: s.endsAt,
  createdAt: s.createdAt,
  reviewedAt: s.reviewedAt,
})

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  catalog() {
    return {
      plans: Object.entries(PLANS).map(([id, p]) => ({ id, ...p })),
      accounts: Object.entries(PAYMENT_ACCOUNTS).map(([id, a]) => ({ id, ...a })),
    }
  }

  /** The user's active premium period (if any) and their latest request, for the app. */
  async status(userId: string) {
    const now = new Date()
    const [active, latest] = await Promise.all([
      this.prisma.subscription.findFirst({
        where: { userId, status: 'APPROVED', startsAt: { lte: now }, endsAt: { gt: now } },
        orderBy: { endsAt: 'desc' },
      }),
      this.prisma.subscription.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    ])
    return { premium: Boolean(active), active: active && subscriptionView(active), latest: latest && subscriptionView(latest) }
  }

  async request(userId: string, input: { plan: SubscriptionPlan; method: SubscriptionPayMethod; receiptFileId: string }) {
    const file = await this.prisma.file.findUnique({ where: { id: input.receiptFileId }, include: { order: { select: { id: true } }, subscription: { select: { id: true } } } })
    if (!file || file.ownerId !== userId) fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'Upload your receipt first.', { receiptFileId: 'Receipt not found.' })
    if (file.order || file.subscription) fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'This receipt was already used. Upload a new one.', { receiptFileId: 'Already used.' })
    const pending = await this.prisma.subscription.findFirst({ where: { userId, status: 'PENDING' } })
    if (pending) fail(HttpStatus.CONFLICT, 'PENDING_EXISTS', 'Your previous payment is still being reviewed. We’ll notify you soon.')
    const created = await this.prisma.subscription.create({
      data: { userId, plan: input.plan, amountEtb: PLANS[input.plan].amountEtb, method: input.method, receiptFileId: file.id },
    })
    return subscriptionView(created)
  }

  // ── Admin ──

  async list(status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    const rows = await this.prisma.subscription.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
      take: 200,
      include: { user: { select: { id: true, name: true, email: true, phone: true } }, receipt: { select: { name: true, mime: true, size: true } } },
    })
    return rows.map((r) => ({ ...subscriptionView(r), user: r.user, receipt: r.receipt }))
  }

  /** Approves a payment. A renewal starts when the current premium period ends, so no paid days are lost. */
  async approve(id: string, adminId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } })
    if (!sub) return notFound('Subscription')
    if (sub.status !== 'PENDING') fail(HttpStatus.CONFLICT, 'ALREADY_REVIEWED', 'This payment was already reviewed.')
    const now = new Date()
    const current = await this.prisma.subscription.findFirst({
      where: { userId: sub.userId, status: 'APPROVED', endsAt: { gt: now } },
      orderBy: { endsAt: 'desc' },
    })
    const startsAt = current?.endsAt && current.endsAt > now ? current.endsAt : now
    const endsAt = addMonths(startsAt, PLANS[sub.plan].months)
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: { status: 'APPROVED', startsAt, endsAt, reviewedById: adminId, reviewedAt: now, rejectionReason: null },
    })
    await this.notifications.send({
      kind: 'SUBSCRIPTION_UPDATE',
      audience: sub.userId,
      title: 'Meri Premium is active',
      body: `Your payment was approved. Premium (${PLANS[sub.plan].label}) is active until ${endsAt.toDateString()}.`,
      createdById: adminId,
      email: true,
    })
    return subscriptionView(updated)
  }

  async reject(id: string, adminId: string, reason: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } })
    if (!sub) return notFound('Subscription')
    if (sub.status !== 'PENDING') fail(HttpStatus.CONFLICT, 'ALREADY_REVIEWED', 'This payment was already reviewed.')
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: { status: 'REJECTED', rejectionReason: reason, reviewedById: adminId, reviewedAt: new Date() },
    })
    await this.notifications.send({
      kind: 'SUBSCRIPTION_UPDATE',
      audience: sub.userId,
      title: 'Payment not approved',
      body: `We couldn’t verify your Meri Premium payment: ${reason} You can upload a new receipt in the app.`,
      createdById: adminId,
      email: true,
    })
    return subscriptionView(updated)
  }
}
