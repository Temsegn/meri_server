import { HttpStatus, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { hash, verify } from '@node-rs/argon2'
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { Role, User } from '@prisma/client'
import { env } from '../config/env'
import { fail } from '../common/errors'
import { MailService } from '../mail/mail.service'
import { PrismaService } from '../prisma/prisma.service'

export type AccessPayload = { sub: string; sid: string; role: Role }
type ClientInfo = { userAgent?: string; ip?: string }

const RESET_TTL_MINUTES = 15
const RESET_MAX_ATTEMPTS = 5

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

export const publicUser = (user: User) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  phone: user.phone,
  role: user.role,
  status: user.status,
  createdAt: user.createdAt,
  hasPassword: Boolean(user.passwordHash),
  hasGoogle: Boolean(user.googleId),
})

@Injectable()
export class AuthService {
  /** Verified against for unknown emails so response time does not reveal which emails exist. */
  private readonly dummyHash = hash(randomBytes(16).toString('hex'))

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  async signUp(input: { name: string; email: string; password: string; phone?: string }, client: ClientInfo) {
    const email = input.email.trim().toLowerCase()
    if (await this.prisma.user.findUnique({ where: { email } })) {
      fail(HttpStatus.CONFLICT, 'EMAIL_TAKEN', 'An account with this email already exists.', {
        email: 'This email is already registered.',
      })
    }
    const user = await this.prisma.user.create({
      data: { email, name: input.name.trim(), phone: input.phone?.trim() || null, passwordHash: await hash(input.password) },
    })
    return { user, ...(await this.startSession(user, client)) }
  }

  async signIn(input: { email: string; password: string }, client: ClientInfo) {
    const user = await this.prisma.user.findUnique({ where: { email: input.email.trim().toLowerCase() } })
    const valid = await verify(user?.passwordHash ?? (await this.dummyHash), input.password).catch(() => false)
    if (!user || !valid) fail(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Email or password is incorrect.')
    if (user.status === 'SUSPENDED') fail(HttpStatus.FORBIDDEN, 'SUSPENDED', 'This account has been suspended. Contact support.')
    return { user, ...(await this.startSession(user, client)) }
  }

  /** Rotates the refresh token and issues a new access token. */
  async refresh(refreshToken: string | undefined) {
    if (!refreshToken) fail(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Please sign in.')
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: sha256(refreshToken) },
      include: { user: true },
    })
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      fail(HttpStatus.UNAUTHORIZED, 'SESSION_EXPIRED', 'Your session has ended. Please sign in again.')
    }
    if (session.user.status === 'SUSPENDED') {
      await this.revoke(session.id)
      fail(HttpStatus.FORBIDDEN, 'SUSPENDED', 'This account has been suspended. Contact support.')
    }
    const nextRefresh = randomBytes(32).toString('base64url')
    await this.prisma.session.update({
      where: { id: session.id },
      data: { refreshTokenHash: sha256(nextRefresh), lastUsedAt: new Date() },
    })
    return { user: session.user, accessToken: this.signAccess(session.user, session.id), refreshToken: nextRefresh }
  }

  async signOut(refreshToken: string | undefined) {
    if (!refreshToken) return
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  /**
   * Google sign-in: match by Google id, else link the account with the same (verified) email, else create a customer.
   */
  async googleSignIn(profile: { sub: string; email: string; name: string }, client: ClientInfo) {
    const email = profile.email.trim().toLowerCase()
    let user = await this.prisma.user.findUnique({ where: { googleId: profile.sub } })
    if (!user) {
      const existing = await this.prisma.user.findUnique({ where: { email } })
      user = existing
        ? await this.prisma.user.update({ where: { id: existing.id }, data: { googleId: profile.sub } })
        : await this.prisma.user.create({ data: { email, name: profile.name.trim().slice(0, 80) || email.split('@')[0], googleId: profile.sub } })
    }
    if (user.status === 'SUSPENDED') fail(HttpStatus.FORBIDDEN, 'SUSPENDED', 'This account has been suspended. Contact support.')
    return { user, ...(await this.startSession(user, client)) }
  }

  /** Verifies the current password, stores the new one and signs out every other device. */
  async changePassword(userId: string, sessionId: string, input: { currentPassword: string; newPassword: string }) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
    // Accounts created with Google have no password yet: they may set one without a current password.
    if (user.passwordHash && !(await verify(user.passwordHash, input.currentPassword).catch(() => false))) {
      fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'Your current password is incorrect.', { currentPassword: 'Incorrect password.' })
    }
    if (input.currentPassword === input.newPassword) {
      fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'Choose a password you have not used here.', { newPassword: 'Must differ from the current one.' })
    }
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hash(input.newPassword) } }),
      this.prisma.session.updateMany({ where: { userId, id: { not: sessionId }, revokedAt: null }, data: { revokedAt: new Date() } }),
    ])
  }

  // ── Forgot password (6-digit code by email) ──

  /** Emails a reset code if the account exists. Always returns quietly so the response never reveals which emails exist. */
  async requestPasswordReset(emailInput: string) {
    const email = emailInput.trim().toLowerCase()
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user || user.status === 'SUSPENDED') return

    // At most one new code per minute per account.
    const recent = await this.prisma.passwordReset.findFirst({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60_000) } } })
    if (recent) return

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    await this.prisma.$transaction([
      this.prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.passwordReset.create({
        data: { userId: user.id, codeHash: this.hashCode(user.id, code), expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000) },
      }),
    ])
    await this.mail.send(
      user.email,
      `${code} is your MeriBoost reset code`,
      `Hi ${user.name},\n\nYour MeriBoost password reset code is: ${code}\n\nIt expires in ${RESET_TTL_MINUTES} minutes. If you did not ask to reset your password, you can ignore this email.`,
    )
  }

  /** Checks the code, sets the new password, signs out every device and starts a new session. */
  async resetPassword(input: { email: string; code: string; newPassword: string }, client: ClientInfo) {
    const invalid = () => fail(HttpStatus.BAD_REQUEST, 'INVALID_CODE', 'That code is not valid. Check the email or request a new code.', { code: 'Invalid code.' })
    const user = await this.prisma.user.findUnique({ where: { email: input.email.trim().toLowerCase() } })
    if (!user) return invalid()
    if (user.status === 'SUSPENDED') fail(HttpStatus.FORBIDDEN, 'SUSPENDED', 'This account has been suspended. Contact support.')

    const reset = await this.prisma.passwordReset.findFirst({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    if (!reset) fail(HttpStatus.BAD_REQUEST, 'CODE_EXPIRED', 'This code has expired. Request a new one.', { code: 'Expired — request a new code.' })
    if (reset.attempts >= RESET_MAX_ATTEMPTS) {
      fail(HttpStatus.TOO_MANY_REQUESTS, 'TOO_MANY_ATTEMPTS', 'Too many wrong codes. Request a new one.', { code: 'Request a new code.' })
    }

    const expected = Buffer.from(reset.codeHash, 'hex')
    const actual = Buffer.from(this.hashCode(user.id, input.code.trim()), 'hex')
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      await this.prisma.passwordReset.update({ where: { id: reset.id }, data: { attempts: { increment: 1 } } })
      return invalid()
    }

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hash(input.newPassword) } }),
      this.prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
      this.prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ])
    return { user, ...(await this.startSession(user, client)) }
  }

  /** HMAC keyed with the server secret, so a database leak does not expose working codes. */
  private hashCode(userId: string, code: string) {
    return createHmac('sha256', env.JWT_SECRET).update(`${userId}:${code}`).digest('hex')
  }

  revoke(sessionId: string) {
    return this.prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } })
  }

  private async startSession(user: User, client: ClientInfo) {
    const refreshToken = randomBytes(32).toString('base64url')
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: sha256(refreshToken),
        userAgent: client.userAgent?.slice(0, 300),
        ip: client.ip,
        expiresAt: new Date(Date.now() + env.SESSION_TTL_DAYS * 86_400_000),
      },
    })
    return { accessToken: this.signAccess(user, session.id), refreshToken }
  }

  private signAccess(user: User, sessionId: string) {
    const payload: AccessPayload = { sub: user.id, sid: sessionId, role: user.role }
    return this.jwt.sign(payload)
  }
}
