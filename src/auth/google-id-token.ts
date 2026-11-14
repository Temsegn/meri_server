import { HttpStatus } from '@nestjs/common'
import { env } from '../config/env'
import { fail } from '../common/errors'

export type GoogleProfile = { sub: string; email: string; name: string }

/** Client ids allowed as the token's audience: the web client (the app's serverClientId) plus any extra mobile ids. */
export const googleAudiences = () =>
  [env.GOOGLE_CLIENT_ID, ...env.GOOGLE_MOBILE_CLIENT_IDS.split(',')].map((v) => v.trim()).filter(Boolean)

/**
 * Verifies a Google ID token from the mobile app with Google's tokeninfo endpoint
 * (Google checks the signature and expiry), then checks audience, issuer and a verified email.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  const audiences = googleAudiences()
  if (!audiences.length) fail(HttpStatus.SERVICE_UNAVAILABLE, 'GOOGLE_UNAVAILABLE', 'Google sign-in is not set up on the server.')
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`)
  if (!res.ok) fail(HttpStatus.UNAUTHORIZED, 'GOOGLE_FAILED', 'Google sign-in failed. Please try again.')
  const info = (await res.json()) as { aud?: string; iss?: string; sub?: string; email?: string; email_verified?: string | boolean; name?: string; exp?: string }
  const issuerOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com'
  const notExpired = Number(info.exp ?? 0) * 1000 > Date.now()
  if (!info.aud || !audiences.includes(info.aud) || !issuerOk || !notExpired || !info.sub) {
    fail(HttpStatus.UNAUTHORIZED, 'GOOGLE_FAILED', 'Google sign-in failed. Please try again.')
  }
  if (!info.email || !(info.email_verified === true || info.email_verified === 'true')) {
    fail(HttpStatus.UNAUTHORIZED, 'GOOGLE_UNVERIFIED', 'Your Google email is not verified.')
  }
  return { sub: info.sub, email: info.email, name: info.name ?? '' }
}
