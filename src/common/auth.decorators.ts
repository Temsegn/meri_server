import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common'
import type { Role } from '@prisma/client'
import type { Request } from 'express'

export type AuthUser = { userId: string; sessionId: string; role: Role; email: string; name: string }
export type AuthedRequest = Request & { auth?: AuthUser }

export const IS_PUBLIC = 'isPublic'
export const ROLES = 'roles'

/** Route needs no sign-in. */
export const Public = () => SetMetadata(IS_PUBLIC, true)
/** Route needs one of these roles (in addition to being signed in). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles)

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth
  if (!auth) throw new Error('CurrentUser used on a public route')
  return auth
})

/** Roles that may open the admin console. */
export const STAFF_ROLES: Role[] = ['ADMIN', 'SUPER_ADMIN']
export const isStaff = (role: Role) => STAFF_ROLES.includes(role)
/** Route is for admins and super admins. */
export const Staff = () => Roles(...STAFF_ROLES)
