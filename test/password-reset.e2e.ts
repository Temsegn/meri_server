/**
 * Forgot password: emailed 6-digit code → reset → signed in. Reads the code from Mailpit (local dev SMTP).
 *   needs the API running with SMTP_URL=smtp://localhost:1025 and Mailpit on :8025
 */
import 'dotenv/config'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Client } from './http-client'

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025'

async function latestCode(to: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const list = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json()) as { messages?: { ID: string; Subject: string }[] }
    const subject = list.messages?.[0]?.Subject
    const match = subject?.match(/^(\d{6}) is your MeriBoost reset code/)
    if (match) return match[1]
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`No reset email for ${to}`)
}

test('forgot password with an emailed code', async () => {
  const email = `reset${Date.now()}@test.local`
  const signup = new Client()
  assert.equal((await signup.call('POST', '/auth/sign-up', { name: 'Reset Tester', email, password: 'original-pass' })).status, 201)

  // Unknown emails get the same answer (no account enumeration).
  assert.equal((await new Client().call('POST', '/auth/forgot-password', { email: `nobody${Date.now()}@test.local` })).status, 204)

  const visitor = new Client()
  assert.equal((await visitor.call('POST', '/auth/forgot-password', { email })).status, 204)
  const code = await latestCode(email)

  const wrong = code === '000000' ? '111111' : '000000'
  const bad = await visitor.call('POST', '/auth/reset-password', { email, code: wrong, newPassword: 'brand-new-pass' })
  assert.equal(bad.status, 400)
  assert.equal(bad.data.error.code, 'INVALID_CODE')

  const ok = await visitor.call('POST', '/auth/reset-password', { email, code, newPassword: 'brand-new-pass' })
  assert.equal(ok.status, 200, JSON.stringify(ok.data))
  assert.equal((await visitor.call('GET', '/auth/me')).data.user.email, email, 'signed in after reset')

  // Old session is gone, old password no longer works, the code cannot be reused.
  assert.equal((await signup.call('GET', '/auth/me')).status, 401)
  assert.equal((await new Client().call('POST', '/auth/sign-in', { email, password: 'original-pass' })).status, 401)
  assert.equal((await new Client().call('POST', '/auth/sign-in', { email, password: 'brand-new-pass' })).status, 200)
  assert.equal((await visitor.call('POST', '/auth/reset-password', { email, code, newPassword: 'another-pass-1' })).status, 400)
})
