import { Body, Controller, Get, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { z } from 'zod'
import { CurrentUser, Staff, type AuthUser } from '../common/auth.decorators'
import { ZodPipe } from '../common/zod.pipe'
import { normalizeTarget } from '../common/targets'
import { PrismaService } from '../prisma/prisma.service'

const accountSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  label: z.string().trim().max(200).default(''),
  subscriptionState: z.enum(['subscribed', 'notSubscribed', 'unknown', 'unavailable']),
  newlySubscribed: z.boolean().default(false),
  checkedAt: z.coerce.date(),
})

const reportSchema = z.object({
  clientTaskId: z.string().trim().min(1).max(64),
  channelUrl: z.string().trim().url().max(300),
  status: z.enum(['starting', 'waitingForYouTube', 'inspecting', 'completed', 'failed']),
  subscribeGoal: z.number().int().min(0).max(100).default(0),
  errorMessage: z.string().max(500).nullish(),
  startedAt: z.coerce.date(),
  accounts: z.array(accountSchema).max(200),
})
type ReportInput = z.infer<typeof reportSchema>

const reportInclude = {
  user: { select: { id: true, name: true, email: true } },
  accounts: { orderBy: { checkedAt: 'asc' as const } },
}

/** Every YouTube account email in the given report rows, with the channels it newly subscribed to. */
function summarizeEmails(rows: { email: string; label: string; newlySubscribed: boolean; checkedAt: Date; report: { channelUrl: string } }[]) {
  const byEmail = new Map<string, { email: string; label: string; checks: number; lastCheckedAt: Date; channels: Set<string> }>()
  for (const row of rows) {
    const entry = byEmail.get(row.email) ?? { email: row.email, label: row.label, checks: 0, lastCheckedAt: row.checkedAt, channels: new Set<string>() }
    entry.checks += 1
    if (row.checkedAt > entry.lastCheckedAt) entry.lastCheckedAt = row.checkedAt
    if (row.newlySubscribed) entry.channels.add(row.report.channelUrl)
    byEmail.set(row.email, entry)
  }
  return [...byEmail.values()]
    .map(({ channels, ...rest }) => ({ ...rest, newSubscriptions: channels.size, channels: [...channels] }))
    .sort((a, b) => b.newSubscriptions - a.newSubscriptions || a.email.localeCompare(b.email))
}

const emailRowSelect = { email: true, label: true, newlySubscribed: true, checkedAt: true, report: { select: { channelUrl: true } } } as const

/**
 * Reports from the Meri Boost phone app: which YouTube accounts newly subscribed to which channel.
 * Admin-only (the phone app signs in with an admin account). Nothing is emailed.
 */
@Controller()
export class BoostController {
  constructor(private readonly prisma: PrismaService) {}

  @Staff()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('boost/reports')
  async saveReport(@CurrentUser() auth: AuthUser, @Body(new ZodPipe(reportSchema)) body: ReportInput) {
    // Last result per email wins (the phone already de-duplicates; this is a safety net).
    const accounts = [...new Map(body.accounts.map((a) => [a.email, a])).values()]
    const newCount = accounts.filter((a) => a.newlySubscribed).length
    const data = {
      channelUrl: body.channelUrl,
      channelKey: normalizeTarget(body.channelUrl),
      status: body.status,
      subscribeGoal: body.subscribeGoal,
      newCount,
      checkedCount: accounts.length,
      errorMessage: body.errorMessage ?? null,
      startedAt: body.startedAt,
    }
    // Re-sending the same phone task replaces its report instead of duplicating it.
    const report = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.boostReport.upsert({
        where: { userId_clientTaskId: { userId: auth.userId, clientTaskId: body.clientTaskId } },
        create: { ...data, userId: auth.userId, clientTaskId: body.clientTaskId },
        update: data,
      })
      await tx.boostReportAccount.deleteMany({ where: { reportId: saved.id } })
      if (accounts.length) {
        await tx.boostReportAccount.createMany({
          data: accounts.map((a) => ({
            reportId: saved.id,
            email: a.email,
            label: a.label || a.email,
            subscriptionState: a.subscriptionState,
            newlySubscribed: a.newlySubscribed,
            checkedAt: a.checkedAt,
          })),
        })
      }
      return saved
    })
    return { report: { id: report.id, newCount, checkedCount: accounts.length } }
  }

  // ── Admin ──
  @Staff()
  @Get('admin/boost-reports')
  async adminReports() {
    const [items, rows] = await Promise.all([
      this.prisma.boostReport.findMany({ orderBy: { startedAt: 'desc' }, take: 500, include: reportInclude }),
      this.prisma.boostReportAccount.findMany({ select: emailRowSelect }),
    ])

    // One entry per YouTube channel: every report for it, and the YouTube subscriber orders for the same channel.
    const keys = [...new Set(items.map((report) => report.channelKey))]
    const orders = keys.length
      ? await this.prisma.order.findMany({
          where: { type: 'YOUTUBE_SUBSCRIBERS', targetNormalized: { in: keys } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, ref: true, status: true, quantity: true, target: true, targetNormalized: true, createdAt: true, user: { select: { name: true, email: true } } },
        })
      : []
    const channels = keys.map((key) => {
      const reports = items.filter((report) => report.channelKey === key)
      const newEmails = new Set<string>()
      const checkedEmails = new Set<string>()
      for (const report of reports) {
        for (const account of report.accounts) {
          checkedEmails.add(account.email)
          if (account.newlySubscribed) newEmails.add(account.email)
        }
      }
      return {
        channelKey: key,
        channelUrl: reports[0].channelUrl,
        reportIds: reports.map((report) => report.id),
        reportCount: reports.length,
        newSubscribers: newEmails.size,
        newEmails: [...newEmails].sort(),
        checkedEmails: checkedEmails.size,
        lastReportAt: reports[0].startedAt,
        orders: orders.filter((order) => order.targetNormalized === key).map(({ targetNormalized: _key, ...order }) => order),
      }
    })

    return { items, emails: summarizeEmails(rows), channels }
  }
}
