import type { CookieOptions, Response } from 'express'
import { env } from '../config/env'

export const ACCESS_COOKIE = 'mb_at'
export const REFRESH_COOKIE = 'mb_rt'
/** Non-secret hint so the Next.js proxy/UI know a session probably exists. */
export const HINT_COOKIE = 'mb_signed_in'

const base: CookieOptions = { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'lax' }

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  const sessionMs = env.SESSION_TTL_DAYS * 86_400_000
  res.cookie(ACCESS_COOKIE, accessToken, { ...base, path: '/', maxAge: env.JWT_ACCESS_TTL_SECONDS * 1000 })
  res.cookie(REFRESH_COOKIE, refreshToken, { ...base, path: '/api/v1/auth', maxAge: sessionMs })
  res.cookie(HINT_COOKIE, '1', { ...base, httpOnly: false, path: '/', maxAge: sessionMs })
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' })
  res.clearCookie(REFRESH_COOKIE, { ...base, path: '/api/v1/auth' })
  res.clearCookie(HINT_COOKIE, { ...base, httpOnly: false, path: '/' })
}
