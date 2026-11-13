import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { CurrentUser, Public, type AuthUser } from '../common/auth.decorators'
import { ZodPipe } from '../common/zod.pipe'
import { PrismaService } from '../prisma/prisma.service'
import { AuthService, publicUser } from './auth.service'
import { REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from './cookies'

const email = z.string().trim().email('Enter a valid email address.').max(200)
const password = z.string().min(8, 'Use at least 8 characters.').max(128)
const signUpSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name.').max(80),
  email,
  password,
  phone: z.string().trim().max(30).optional(),
})
const signInSchema = z.object({ email, password: z.string().min(1, 'Enter your password.').max(128) })
const profileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
})

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.').max(128),
  newPassword: password,
})

const client = (req: Request) => ({ userAgent: req.headers['user-agent'], ip: req.ip })

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('sign-up')
  async signUp(@Body(new ZodPipe(signUpSchema)) body: z.infer<typeof signUpSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, accessToken, refreshToken } = await this.auth.signUp(body, client(req))
    setAuthCookies(res, accessToken, refreshToken)
    return { user: publicUser(user) }
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('sign-in')
  async signIn(@Body(new ZodPipe(signInSchema)) body: z.infer<typeof signInSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, accessToken, refreshToken } = await this.auth.signIn(body, client(req))
    setAuthCookies(res, accessToken, refreshToken)
    return { user: publicUser(user) }
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const { user, accessToken, refreshToken } = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE])
      setAuthCookies(res, accessToken, refreshToken)
      return { user: publicUser(user) }
    } catch (error) {
      clearAuthCookies(res)
      throw error
    }
  }

  @Public()
  @HttpCode(204)
  @Post('sign-out')
  async signOut(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.signOut(req.cookies?.[REFRESH_COOKIE])
    clearAuthCookies(res)
  }

  @Get('me')
  async me(@CurrentUser() auth: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } })
    return { user: publicUser(user) }
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(204)
  @Post('password')
  async changePassword(@CurrentUser() auth: AuthUser, @Body(new ZodPipe(passwordSchema)) body: z.infer<typeof passwordSchema>) {
    await this.auth.changePassword(auth.userId, auth.sessionId, body)
  }

  @Patch('me')
  async updateMe(@CurrentUser() auth: AuthUser, @Body(new ZodPipe(profileSchema)) body: z.infer<typeof profileSchema>) {
    const user = await this.prisma.user.update({ where: { id: auth.userId }, data: body })
    return { user: publicUser(user) }
  }
}
