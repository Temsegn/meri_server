import { Body, Controller, Get, HttpCode, Patch, Post, Query, Req, Res } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { env } from '../config/env'
import { isStaff } from '../common/auth.decorators'
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

const forgotSchema = z.object({ email })
const resetSchema = z.object({
  email,
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.'),
  newPassword: password,
})

const passwordSchema = z.object({
  currentPassword: z.string().max(128).default(''),
  newPassword: password,
})

const OAUTH_COOKIE = 'mb_oauth'
const googleRedirectUri = () => env.GOOGLE_REDIRECT_URI ?? `${env.CLIENT_URL}/api/v1/auth/google/callback`
/** Only same-site relative paths. */
const safeNext = (value?: string) => (value && value.startsWith('/') && !value.startsWith('//') ? value : null)

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

  // ── Forgot password ──
  /** Always 204: the response is the same whether or not the email has an account. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(204)
  @Post('forgot-password')
  async forgotPassword(@Body(new ZodPipe(forgotSchema)) body: z.infer<typeof forgotSchema>) {
    await this.auth.requestPasswordReset(body.email)
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('reset-password')
  async resetPassword(@Body(new ZodPipe(resetSchema)) body: z.infer<typeof resetSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, accessToken, refreshToken } = await this.auth.resetPassword(body, client(req))
    setAuthCookies(res, accessToken, refreshToken)
    return { user: publicUser(user) }
  }

  // ── Google sign-in ──
  /** Sends the browser to Google. `next` is where to land afterwards (same-site paths only). */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('google')
  google(@Query('next') next: string | undefined, @Res() res: Response) {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return res.redirect(302, `${env.CLIENT_URL}/sign-in?error=google_unavailable`)
    const state = randomBytes(24).toString('base64url')
    res.cookie(OAUTH_COOKIE, JSON.stringify({ state, next: safeNext(next) }), {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/api/v1/auth/google',
      maxAge: 10 * 60_000,
    })
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: googleRedirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    })
    res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params}`)
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('google/callback')
  async googleCallback(@Query() query: Record<string, string | undefined>, @Req() req: Request, @Res() res: Response) {
    const failTo = (reason: string) => res.redirect(302, `${env.CLIENT_URL}/sign-in?error=${reason}`)
    let saved: { state?: string; next?: string | null } = {}
    try {
      saved = JSON.parse(req.cookies?.[OAUTH_COOKIE] ?? '{}')
    } catch {
      /* treated as a missing state below */
    }
    res.clearCookie(OAUTH_COOKIE, { path: '/api/v1/auth/google' })
    if (query.error) return failTo('google_cancelled')
    if (!query.code || !query.state || query.state !== saved.state) return failTo('google_failed')

    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: query.code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: googleRedirectUri(),
          grant_type: 'authorization_code',
        }),
      })
      if (!tokenRes.ok) return failTo('google_failed')
      const { access_token } = (await tokenRes.json()) as { access_token?: string }
      const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${access_token}` } })
      if (!profileRes.ok) return failTo('google_failed')
      const profile = (await profileRes.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string }
      if (!profile.sub || !profile.email || !profile.email_verified) return failTo('google_unverified')

      const { user, accessToken, refreshToken } = await this.auth.googleSignIn(
        { sub: profile.sub, email: profile.email, name: profile.name ?? '' },
        client(req),
      )
      setAuthCookies(res, accessToken, refreshToken)
      res.redirect(302, `${env.CLIENT_URL}${saved.next ?? (isStaff(user.role) ? '/admin' : '/my-promotions')}`)
    } catch (error) {
      if ((error as { response?: { code?: string } })?.response?.code === 'SUSPENDED') return failTo('suspended')
      return failTo('google_failed')
    }
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
