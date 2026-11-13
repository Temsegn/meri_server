import { Body, Controller, Get, HttpStatus, Param, Patch, Post } from '@nestjs/common'
import { hash } from '@node-rs/argon2'
import { z } from 'zod'
import { AuditService } from '../audit/audit.service'
import { CurrentUser, Roles, type AuthUser } from '../common/auth.decorators'
import { fail, notFound } from '../common/errors'
import { ZodPipe } from '../common/zod.pipe'
import { PrismaService } from '../prisma/prisma.service'

const staffRole = z.enum(['ADMIN', 'SUPER_ADMIN'])
const inviteBody = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(200),
  role: staffRole,
  /** Only needed when the email has no account yet. */
  name: z.string().trim().max(80).optional(),
  password: z.string().max(128).optional(),
})
const patchBody = z.object({
  role: z.enum(['CUSTOMER', 'ADMIN', 'SUPER_ADMIN']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
})

const staffSelect = { id: true, name: true, email: true, role: true, status: true, createdAt: true } as const

/** Super admins manage who can open the admin console. */
@Roles('SUPER_ADMIN')
@Controller('admin/team')
export class AdminTeamController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list() {
    const staff = await this.prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
      orderBy: [{ role: 'desc' }, { createdAt: 'asc' }],
      select: { ...staffSelect, sessions: { orderBy: { lastUsedAt: 'desc' }, take: 1, select: { lastUsedAt: true } } },
    })
    const actions = await this.prisma.auditLog.groupBy({
      by: ['actorId'],
      where: { actorId: { in: staff.map((user) => user.id) } },
      _count: { _all: true },
    })
    const actionCount = new Map(actions.map((row) => [row.actorId, row._count._all]))
    return {
      items: staff.map(({ sessions, ...user }) => ({
        ...user,
        lastActiveAt: sessions[0]?.lastUsedAt ?? null,
        actionCount: actionCount.get(user.id) ?? 0,
      })),
    }
  }

  /** Promotes an existing account, or creates a new staff account when the email is unknown. */
  @Post()
  async invite(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(inviteBody)) body: z.infer<typeof inviteBody>) {
    const existing = await this.prisma.user.findUnique({ where: { email: body.email } })
    if (existing) {
      if (existing.role !== 'CUSTOMER') fail(HttpStatus.CONFLICT, 'ALREADY_STAFF', 'This person is already on the team.', { email: 'Already on the team.' })
      const user = await this.prisma.user.update({ where: { id: existing.id }, data: { role: body.role, status: 'ACTIVE' }, select: staffSelect })
      await this.audit.log(actor.userId, 'team.promote', 'User', user.id, { role: body.role })
      return { ...user, created: false }
    }

    const fields: Record<string, string> = {}
    if (!body.name || body.name.length < 2) fields.name = 'Enter their full name.'
    if (!body.password || body.password.length < 12) fields.password = 'Use at least 12 characters.'
    if (Object.keys(fields).length) fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'No account uses this email yet — add a name and password.', fields)

    const user = await this.prisma.user.create({
      data: { email: body.email, name: body.name!, role: body.role, passwordHash: await hash(body.password!) },
      select: staffSelect,
    })
    await this.audit.log(actor.userId, 'team.create', 'User', user.id, { role: body.role })
    return { ...user, created: true }
  }

  @Patch(':id')
  async patch(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body(new ZodPipe(patchBody)) body: z.infer<typeof patchBody>) {
    if (id === actor.userId) fail(HttpStatus.BAD_REQUEST, 'SELF', 'You cannot change your own role or status.')
    const target = await this.prisma.user.findUnique({ where: { id } })
    if (!target || target.role === 'CUSTOMER') return notFound('Team member')

    const losingSuper = target.role === 'SUPER_ADMIN' && (body.role !== undefined && body.role !== 'SUPER_ADMIN' || body.status === 'SUSPENDED')
    if (losingSuper && (await this.prisma.user.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } })) <= 1) {
      fail(HttpStatus.CONFLICT, 'LAST_SUPER_ADMIN', 'Keep at least one active super admin.')
    }

    const user = await this.prisma.user.update({ where: { id }, data: body, select: staffSelect })
    // Removing access signs them out everywhere.
    if (body.status === 'SUSPENDED' || body.role === 'CUSTOMER') {
      await this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } })
    }
    await this.audit.log(actor.userId, 'team.update', 'User', id, body)
    return user
  }
}
