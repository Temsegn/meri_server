import { Body, Controller, Get, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { z } from 'zod'
import { CurrentUser, Staff, type AuthUser } from '../common/auth.decorators'
import { ZodPipe } from '../common/zod.pipe'
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
 * Stored only — nothing is emailed. Admins see them under /admin/boost-reports.
 */
@Controller()
export class BoostController {
  constructor(private readonly prisma: PrismaService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('boost/reports')
  async saveReport(@CurrentUser() auth: AuthUser, @Body(new ZodPipe(reportSchema)) body: ReportInput) {
    // Last result per email wins (the phone already de-duplicates; this is a safety net).
    const accounts = [...new Map(body.accounts.map((a) => [a.email, a])).values()]
    const newCount = accounts.filter((a) => a.newlySubscribed).length
    const data = {
      channelUrl: body.channelUrl,
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

  /** The signed-in user's own reports (used by the phone app). */
  @Get('boost/reports')
  async myReports(@CurrentUser() auth: AuthUser) {
    const items = await this.prisma.boostReport.findMany({ where: { userId: auth.userId }, orderBy: { startedAt: 'desc' }, take: 50, include: reportInclude })
    return { items }
  }

  @Get('boost/emails')
  async myEmails(@CurrentUser() auth: AuthUser) {
    const rows = await this.prisma.boostReportAccount.findMany({ where: { report: { userId: auth.userId } }, select: emailRowSelect })
    return { items: summarizeEmails(rows) }
  }

  // ── Admin ──
  @Staff()
  @Get('admin/boost-reports')
  async adminReports() {
    const [items, rows] = await Promise.all([
      this.prisma.boostReport.findMany({ orderBy: { startedAt: 'desc' }, take: 200, include: reportInclude }),
      this.prisma.boostReportAccount.findMany({ select: emailRowSelect }),
    ])
    return { items, emails: summarizeEmails(rows) }
  }
}
