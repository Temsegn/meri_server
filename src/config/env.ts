import 'dotenv/config'
import { z } from 'zod'

const bool = z.enum(['true', 'false']).transform((value) => value === 'true')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: bool.default('false'),
  S3_ENDPOINT: z.string().url(),
  /** Endpoint the browser can reach, used for signed download URLs (defaults to S3_ENDPOINT). */
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_CREATE_BUCKET: bool.default('false'),
  SMTP_URL: z.string().optional().default(''),
  /** Google sign-in (optional). Leave empty to hide it. */
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  /** Defaults to CLIENT_URL + /api/v1/auth/google/callback (through the web app's /api proxy, so cookies are first-party). */
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  MAIL_FROM: z.string().default('MeriBoost <no-reply@meriboost.local>'),
  /**
   * Extra Google OAuth client ids whose ID tokens the mobile app may send (comma-separated).
   * The Flutter app normally requests tokens for GOOGLE_CLIENT_ID (its serverClientId), which is always accepted.
   */
  GOOGLE_MOBILE_CLIENT_IDS: z.string().optional().default(''),
  /** Meri Assistant (Gemini). Leave the key empty to turn the assistant off. */
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),
})

/**
 * Undo common copy-paste mistakes from hosting dashboards: a value that repeats its own key
 * ("SMTP_URL=smtps://…") or keeps the quotes from a .env file ("\"MeriBoost <…>\"").
 */
function clean(source: NodeJS.ProcessEnv) {
  const out: Record<string, string | undefined> = {}
  for (const [key, raw] of Object.entries(source)) {
    let value = raw?.trim()
    if (value?.startsWith(`${key}=`)) value = value.slice(key.length + 1).trim()
    if (value && value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) value = value.slice(1, -1)
    out[key] = value
  }
  return out
}

const parsed = schema.safeParse(clean(process.env))
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
