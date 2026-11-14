/**
 * Meri Premium: upload receipt → request (PENDING) → admin approves → premium active; reject path too.
 *   npm run test:e2e
 */
import 'dotenv/config'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Client } from './http-client'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function upload(client: Client) {
  const form = new FormData()
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'receipt.png')
  const res = await client.call('POST', '/files/receipts', undefined, form)
  assert.equal(res.status, 201, JSON.stringify(res.data))
  return res.data.id as string
}

test('subscription request is pending until an admin approves it', async () => {
  const stamp = Date.now()
  const user = new Client()
  assert.equal((await user.call('POST', '/auth/sign-up', { name: 'Premium Tester', email: `premium${stamp}@test.local`, password: 'correct-horse-1' })).status, 201)
  const admin = new Client()
  assert.equal((await admin.call('POST', '/auth/sign-in', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).status, 200)

  const catalog = (await user.call('GET', '/subscriptions/plans')).data
  assert.deepEqual(catalog.plans.map((p: { id: string }) => p.id), ['SIX_MONTHS', 'ONE_YEAR'])
  assert.ok(catalog.accounts.some((a: { account: string }) => a.account === '9992327207'))

  assert.equal((await user.call('GET', '/subscriptions/me')).data.premium, false)

  const receipt = await upload(user)
  const req = await user.call('POST', '/subscriptions', { plan: 'SIX_MONTHS', method: 'TELEBIRR', receiptFileId: receipt })
  assert.equal(req.status, 201, JSON.stringify(req.data))
  assert.equal(req.data.status, 'PENDING')
  assert.equal(req.data.amountEtb, 380)

  // Still not premium; a second request waits; the same receipt can't be reused.
  const me = (await user.call('GET', '/subscriptions/me')).data
  assert.equal(me.premium, false)
  assert.equal(me.latest.status, 'PENDING')
  assert.equal((await user.call('POST', '/subscriptions', { plan: 'ONE_YEAR', method: 'CBE', receiptFileId: await upload(user) })).status, 409)
  assert.equal((await user.call('POST', '/subscriptions', { plan: 'ONE_YEAR', method: 'CBE', receiptFileId: receipt })).status, 400)

  // Customers can't reach the admin queue.
  assert.equal((await user.call('GET', '/admin/subscriptions')).status, 403)

  const queue = (await admin.call('GET', '/admin/subscriptions?status=PENDING')).data as { id: string }[]
  assert.ok(queue.some((s) => s.id === req.data.id))
  const approved = await admin.call('POST', `/admin/subscriptions/${req.data.id}/approve`)
  assert.equal(approved.status, 200, JSON.stringify(approved.data))
  const after = (await user.call('GET', '/subscriptions/me')).data
  assert.equal(after.premium, true)
  const days = (new Date(after.active.endsAt).getTime() - Date.now()) / 86_400_000
  assert.ok(days > 175 && days < 186, `six months ≈ ${days} days`)
  assert.equal((await admin.call('POST', `/admin/subscriptions/${req.data.id}/approve`)).status, 409)

  // Renewal starts when the current period ends; rejection needs a reason.
  const second = await user.call('POST', '/subscriptions', { plan: 'ONE_YEAR', method: 'ABYSSINIA', receiptFileId: await upload(user) })
  assert.equal(second.status, 201)
  assert.equal((await admin.call('POST', `/admin/subscriptions/${second.data.id}/reject`, { reason: '' })).status, 400)
  const rejected = await admin.call('POST', `/admin/subscriptions/${second.data.id}/reject`, { reason: 'The amount on the receipt does not match.' })
  assert.equal(rejected.data.status, 'REJECTED')
  assert.equal((await user.call('GET', '/subscriptions/me')).data.premium, true, 'still premium from the first approval')
})
