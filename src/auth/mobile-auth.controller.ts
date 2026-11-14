import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Request } from 'express'
import { z } from 'zod'
import { env } from '../config/env'
import { Public } from '../common/auth.decorators'
import { ZodPipe } from '../common/zod.pipe'
import { AuthService, publicUser } from './auth.service'
import { verifyGoogleIdToken } from './google-id-token'

/**
 * Auth for the Meri mobile app. Same accounts and rules as the web endpoints in AuthController,
 * but tokens travel in the JSON body (stored in the device keychain) instead of cookies.
 */
const email = z.string().trim().email('Enter a valid email address.').max(200)
const password = z.string().min(8, 'Use at least 8 characters.').max(128)
const signUpSchema = z.object({ name: z.string().trim().min(2, 'Enter your full name.').max(80), email, password, phone: z.string().trim().max(30).optional() })
const signInSchema = z.object({ email, password: z.string().min(1, 'Enter your password.').max(128) })
const refreshSchema = z.object({ refreshToken: z.string().min(10).max(200) })
const googleSchema = z.object({ idToken: z.string().min(20).max(4096) })
const resetSchema = z.object({
  email,
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.'),
  newPassword: password,
})

const client = (req: Request) => ({ userAgent: req.headers['user-agent'] ?? 'Meri mobile', ip: req.ip })

type Session = Awaited<ReturnType<AuthService['signIn']>>
const tokens = ({ user, accessToken, refreshToken }: Session) => ({
  user: publicUser(user),
  accessToken,
  refreshToken,
  accessTokenExpiresIn: env.JWT_ACCESS_TTL_SECONDS,
})

@Controller('auth/mobile')
export class MobileAuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('sign-up')
  async signUp(@Body(new ZodPipe(signUpSchema)) body: z.infer<typeof signUpSchema>, @Req() req: Request) {
    return tokens(await this.auth.signUp(body, client(req)))
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('sign-in')
  async signIn(@Body(new ZodPipe(signInSchema)) body: z.infer<typeof signInSchema>, @Req() req: Request) {
    return tokens(await this.auth.signIn(body, client(req)))
  }

  /** Google: verifies the ID token from google_sign_in, then signs in, links by email, or creates the account. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('google')
  async google(@Body(new ZodPipe(googleSchema)) body: z.infer<typeof googleSchema>, @Req() req: Request) {
    const profile = await verifyGoogleIdToken(body.idToken)
    return tokens(await this.auth.googleSignIn(profile, client(req)))
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    return tokens(await this.auth.refresh(body.refreshToken))
  }

  @Public()
  @HttpCode(204)
  @Post('sign-out')
  async signOut(@Body(new ZodPipe(refreshSchema.partial())) body: { refreshToken?: string }) {
    await this.auth.signOut(body.refreshToken)
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('reset-password')
  async resetPassword(@Body(new ZodPipe(resetSchema)) body: z.infer<typeof resetSchema>, @Req() req: Request) {
    return tokens(await this.auth.resetPassword(body, client(req)))
  }
}
