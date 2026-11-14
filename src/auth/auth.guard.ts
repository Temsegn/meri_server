import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService, TokenExpiredError } from '@nestjs/jwt'
import type { Role } from '@prisma/client'
import { fail } from '../common/errors'
import { IS_PUBLIC, ROLES, type AuthedRequest } from '../common/auth.decorators'
import { PrismaService } from '../prisma/prisma.service'
import { ACCESS_COOKIE } from './cookies'
import type { AccessPayload } from './auth.service'

/**
 * Global guard. Verifies the JWT access token, then checks its session row so sign-out,
 * suspension and revocation take effect immediately.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()]
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true

    const req = context.switchToHttp().getRequest<AuthedRequest>()
    // Browsers send the access token as a cookie; the mobile app sends `Authorization: Bearer <token>`.
    const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
    const token: string | undefined = bearer ?? req.cookies?.[ACCESS_COOKIE]
    if (!token) fail(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Please sign in.')

    let payload: AccessPayload
    try {
      payload = this.jwt.verify<AccessPayload>(token)
    } catch (error) {
      if (error instanceof TokenExpiredError) fail(HttpStatus.UNAUTHORIZED, 'TOKEN_EXPIRED', 'Session token expired.')
      fail(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Please sign in.')
    }

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      select: { revokedAt: true, expiresAt: true, user: { select: { id: true, role: true, status: true, email: true, name: true } } },
    })
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.id !== payload.sub) {
      fail(HttpStatus.UNAUTHORIZED, 'SESSION_EXPIRED', 'Your session has ended. Please sign in again.')
    }
    if (session.user.status === 'SUSPENDED') fail(HttpStatus.FORBIDDEN, 'SUSPENDED', 'This account has been suspended.')

    req.auth = {
      userId: session.user.id,
      sessionId: payload.sid,
      role: session.user.role,
      email: session.user.email,
      name: session.user.name,
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets)
    if (roles?.length && !roles.includes(session.user.role)) {
      fail(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You do not have access to this area.')
    }
    return true
  }
}
