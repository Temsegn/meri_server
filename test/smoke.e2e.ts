/**
 * End-to-end smoke test against a running API (npm run dev) with a seeded DB.
 *   npm run test:e2e
 * Covers: auth (JWT + rotating refresh session), receipt upload to R2, order creation,
 * admin status flow + rules, delivery emails, notifications, suspension.
 */
import 'dotenv/config'
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Client } from './http-client'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test('full order lifecycle', async () => {
  const stamp = Date.now()
  const customer = new Client()
  const admin = new Client()

  // Sign up + me
  const signUp = await customer.call('POST', '/auth/sign-up', { name: 'Smoke Tester', email: `smoke${stamp}@test.local`, password: 'correct-horse-1' })
  assert.equal(signUp.status, 201, JSON.stringify(signUp.data))
  assert.ok(customer.cookies.has('mb_at') && customer.cookies.has('mb_rt'))
  assert.equal((await customer.call('GET', '/auth/me')).data.user.role, 'CUSTOMER')

  // Duplicate email
  assert.equal((await new Client().call('POST', '/auth/sign-up', { name: 'Dup', email: `smoke${stamp}@test.local`, password: 'correct-horse-1' })).status, 409)

  // Customer cannot reach admin
  assert.equal((await customer.call('GET', '/admin/orders?types=YOUTUBE_SUBSCRIBERS')).status, 403)

  // Refresh rotates the refresh token; the old one stops working
  const oldRefresh = customer.cookies.get('mb_rt')
  assert.equal((await customer.call('POST', '/auth/refresh')).status, 200)
  assert.notEqual(customer.cookies.get('mb_rt'), oldRefresh)
  const replay = new Client()
  replay.cookies.set('mb_rt', oldRefresh!)
  assert.equal((await replay.call('POST', '/auth/refresh')).status, 401)

  // Receipt upload: wrong type rejected, PNG accepted
  const bad = new FormData()
  bad.append('file', new Blob([Buffer.from('hello')], { type: 'image/png' }), 'fake.png')
  assert.equal((await customer.call('POST', '/files/receipts', undefined, bad)).status, 400)
  const form = new FormData()
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'receipt.png')
  const upload = await customer.call('POST', '/files/receipts', undefined, form)
  assert.equal(upload.status, 201, JSON.stringify(upload.data))

  // Create a YouTube order (smallest package); price comes from the server
  const pkg = (await customer.call('GET', '/packages?type=YOUTUBE_SUBSCRIBERS')).data.items[0]
  const badTarget = await customer.call('POST', '/orders', { type: 'YOUTUBE_SUBSCRIBERS', packageId: pkg.id, target: 'not a channel', paymentMethod: 'Telebirr', receiptFileId: upload.data.id })
  assert.equal(badTarget.status, 400)
  const channel = `@smoke${stamp}`
  const created = await customer.call('POST', '/orders', { type: 'YOUTUBE_SUBSCRIBERS', packageId: pkg.id, target: channel, paymentMethod: 'Telebirr', receiptFileId: upload.data.id })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  assert.equal(created.data.status, 'PENDING')
  assert.equal(created.data.amountEtb, pkg.priceEtb)
  assert.match(created.data.ref, /^YT-\d{5}$/)
  const orderId = created.data.id

  // Receipt cannot be reused
  assert.equal((await customer.call('POST', '/orders', { type: 'YOUTUBE_SUBSCRIBERS', packageId: pkg.id, target: channel, paymentMethod: 'CBE', receiptFileId: upload.data.id })).status, 409)

  // Owner can open the receipt (redirect to signed R2 URL); signed URL serves the file
  const file = await customer.call('GET', `/files/${upload.data.id}`)
  assert.equal(file.status, 302)
  const signed = await fetch(file.headers.get('location')!)
  assert.equal(signed.status, 200)

  // Admin flow
  assert.equal((await admin.call('POST', '/auth/sign-in', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).status, 200)
  const board = await admin.call('GET', `/admin/orders?types=YOUTUBE_SUBSCRIBERS&q=${encodeURIComponent(channel)}`)
  assert.equal(board.data.items[0].id, orderId)
  assert.deepEqual(board.data.items[0].nextStatuses, ['ACCEPTED', 'REJECTED'])

  // Invalid jump and reject-without-reason are refused
  assert.equal((await admin.call('POST', `/admin/orders/${orderId}/status`, { status: 'COMPLETED' })).status, 409)
  assert.equal((await admin.call('POST', `/admin/orders/${orderId}/status`, { status: 'REJECTED' })).status, 400)

  assert.equal((await admin.call('POST', `/admin/orders/${orderId}/status`, { status: 'ACCEPTED' })).data.status, 'ACCEPTED')
  assert.equal((await admin.call('POST', `/admin/orders/${orderId}/status`, { status: 'IN_PROGRESS' })).data.status, 'IN_PROGRESS')

  // Delivery emails: add two, assign them
  const e1 = await admin.call('POST', '/admin/delivery-emails', { address: `d1-${stamp}@test.local`, platforms: ['YOUTUBE'] })
  const e2 = await admin.call('POST', '/admin/delivery-emails', { address: `d2-${stamp}@test.local`, platforms: ['INSTAGRAM'] })
  assert.equal(e1.status, 201)
  const wrongPlatform = await admin.call('PUT', `/admin/orders/${orderId}/deliveries`, { emailIds: [e2.data.id] })
  assert.equal(wrongPlatform.status, 409)
  const delivered = await admin.call('PUT', `/admin/orders/${orderId}/deliveries`, { emailIds: [e1.data.id] })
  assert.equal(delivered.data.deliveredCount, 1)

  // Completing with fewer deliveries than ordered needs force
  assert.equal((await admin.call('POST', `/admin/orders/${orderId}/status`, { status: 'COMPLETED' })).status, 409)
  const done = await admin.call('POST', `/admin/orders/${orderId}/status`, { status: 'COMPLETED', force: true, note: 'smoke test' })
  assert.equal(done.data.status, 'COMPLETED')

  // Email usage is tracked and the used email cannot be deleted
  const emails = await admin.call('GET', '/admin/delivery-emails')
  assert.equal(emails.data.items.find((e: { id: string }) => e.id === e1.data.id).usage[0].id, orderId)
  assert.equal((await admin.call('DELETE', `/admin/delivery-emails/${e1.data.id}`)).status, 409)

  // Same email can't deliver to the same channel on a second order
  const form2 = new FormData()
  form2.append('file', new Blob([PNG], { type: 'image/png' }), 'receipt2.png')
  const upload2 = await customer.call('POST', '/files/receipts', undefined, form2)
  const second = await customer.call('POST', '/orders', { type: 'YOUTUBE_SUBSCRIBERS', packageId: pkg.id, target: `https://youtube.com/${channel}/videos`, paymentMethod: 'CBE', receiptFileId: upload2.data.id })
  assert.equal((await admin.call('PUT', `/admin/orders/${second.data.id}/deliveries`, { emailIds: [e1.data.id] })).status, 409)

  // Customer sees progress and got order-update notifications
  const mine = await customer.call('GET', '/orders')
  const first = mine.data.items.find((o: { id: string }) => o.id === orderId)
  assert.equal(first.status, 'COMPLETED')
  assert.equal(first.deliveredCount, 1)
  const inbox = await customer.call('GET', '/notifications')
  assert.ok(inbox.data.unread >= 3)
  assert.equal((await customer.call('POST', '/notifications/read-all')).status, 204)
  assert.equal((await customer.call('GET', '/notifications')).data.unread, 0)

  // Admin broadcast reaches the customer
  const userId = signUp.data.user.id
  assert.equal((await admin.call('POST', '/admin/notifications', { audience: userId, title: 'Hello', body: 'Direct message' })).status, 201)
  assert.equal((await customer.call('GET', '/notifications')).data.unread, 1)

  // Suspension revokes sessions immediately
  assert.equal((await admin.call('PATCH', `/admin/users/${userId}`, { status: 'SUSPENDED' })).status, 200)
  assert.equal((await customer.call('GET', '/orders')).status, 401)
  assert.equal((await new Client().call('POST', '/auth/sign-in', { email: `smoke${stamp}@test.local`, password: 'correct-horse-1' })).status, 403)

  // Sign-out revokes the admin session
  assert.equal((await admin.call('POST', '/auth/sign-out')).status, 204)
  assert.equal((await admin.call('GET', '/auth/me')).status, 401)
})
