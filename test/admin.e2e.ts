/**
 * Admin console e2e: overview, catalog CRUD, team rules (super admin only), activity log, password change.
 * Needs a running API with a seeded DB (SEED_DEMO=true):  npm run test:e2e
 */
import 'dotenv/config'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Client } from './http-client'

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo-password-1'

async function signIn(email: string, password: string) {
  const client = new Client()
  const res = await client.call('POST', '/auth/sign-in', { email, password })
  assert.equal(res.status, 200, `sign-in ${email}: ${JSON.stringify(res.data)}`)
  return client
}

test('super admin, admin and customer permissions + admin features', async () => {
  const superAdmin = await signIn(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!)
  assert.equal((await superAdmin.call('GET', '/auth/me')).data.user.role, 'SUPER_ADMIN')
  const admin = await signIn('selam@demo.meriboost.local', DEMO_PASSWORD)
  const customer = await signIn('ava@demo.meriboost.local', DEMO_PASSWORD)

  // Overview
  const overview = await admin.call('GET', '/admin/overview?days=30')
  assert.equal(overview.status, 200)
  assert.equal(overview.data.series.length, 30)
  assert.ok(overview.data.totals.customers >= 20)
  assert.equal((await admin.call('GET', '/admin/overview?days=12')).status, 400)
  assert.equal((await customer.call('GET', '/admin/overview')).status, 403)

  // Packages: create → price change → popular is exclusive → hide → delete
  const quantity = 900_000 + Math.floor(Math.random() * 90_000)
  const created = await admin.call('POST', '/admin/packages', { type: 'YOUTUBE_SUBSCRIBERS', quantity, priceEtb: 1234, popular: false, active: true })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  assert.equal((await admin.call('POST', '/admin/packages', { type: 'YOUTUBE_SUBSCRIBERS', quantity, priceEtb: 1 })).status, 409)
  assert.equal((await admin.call('PATCH', `/admin/packages/${created.data.id}`, { priceEtb: 4321, popular: true })).data.priceEtb, 4321)
  const yt = (await admin.call('GET', '/admin/packages')).data.items.filter((p: { type: string }) => p.type === 'YOUTUBE_SUBSCRIBERS')
  assert.equal(yt.filter((p: { popular: boolean }) => p.popular).length, 1)
  await admin.call('PATCH', `/admin/packages/${created.data.id}`, { active: false })
  const publicIds = (await new Client().call('GET', '/packages?type=YOUTUBE_SUBSCRIBERS')).data.items.map((p: { id: string }) => p.id)
  assert.ok(!publicIds.includes(created.data.id), 'hidden package is not public')
  assert.equal((await admin.call('DELETE', `/admin/packages/${created.data.id}`)).status, 204)
  // Restore the seeded "most popular" badge
  const seeded = yt.find((p: { quantity: number }) => p.quantity === 500)
  if (seeded) await admin.call('PATCH', `/admin/packages/${seeded.id}`, { popular: true })

  // Package with orders cannot be deleted
  const used = (await admin.call('GET', '/admin/packages')).data.items.find((p: { orderCount: number }) => p.orderCount > 0)
  assert.equal((await admin.call('DELETE', `/admin/packages/${used.id}`)).status, 409)

  // Listings
  const listing = await admin.call('POST', '/admin/listings', { platform: 'YOUTUBE', name: 'E2E Listing', profileUrl: 'https://youtube.com/@e2e_listing', audience: '1,000 subscribers', includes: '1 channel', priceEtb: 5000, status: 'IN_REVIEW' })
  assert.equal(listing.status, 201, JSON.stringify(listing.data))
  assert.equal((await admin.call('PATCH', `/admin/listings/${listing.data.id}`, { status: 'ARCHIVED' })).data.status, 'ARCHIVED')
  assert.equal((await admin.call('DELETE', `/admin/listings/${listing.data.id}`)).status, 204)

  // Activity log records those changes
  const audit = await admin.call('GET', '/admin/audit?entity=Package')
  assert.ok(audit.data.items.some((item: { action: string }) => item.action === 'package.delete'))

  // Team: only super admins
  assert.equal((await admin.call('GET', '/admin/team')).status, 403)
  const team = await superAdmin.call('GET', '/admin/team')
  assert.equal(team.status, 200)
  assert.ok(team.data.items.length >= 3)
  const stamp = Date.now()
  const invite = await superAdmin.call('POST', '/admin/team', { email: `staff${stamp}@test.local`, role: 'ADMIN', name: 'E2E Staff', password: 'temporary-pass-1' })
  assert.equal(invite.status, 201, JSON.stringify(invite.data))
  assert.equal(invite.data.created, true)
  const staff = await signIn(`staff${stamp}@test.local`, 'temporary-pass-1')
  assert.equal((await staff.call('GET', '/admin/overview')).status, 200)
  // Removing access ends their session immediately
  assert.equal((await superAdmin.call('PATCH', `/admin/team/${invite.data.id}`, { role: 'CUSTOMER' })).status, 200)
  assert.equal((await staff.call('GET', '/admin/overview')).status, 401)
  // Cannot change yourself; admins cannot suspend staff from the customer screen
  const me = (await superAdmin.call('GET', '/auth/me')).data.user
  assert.equal((await superAdmin.call('PATCH', `/admin/team/${me.id}`, { role: 'ADMIN' })).status, 400)
  const yonas = team.data.items.find((member: { email: string }) => member.email === 'yonas@demo.meriboost.local')
  assert.equal((await admin.call('PATCH', `/admin/users/${yonas.id}`, { status: 'SUSPENDED' })).status, 403)

  // Customer list excludes staff
  const users = (await admin.call('GET', '/admin/users')).data.items
  assert.ok(users.every((user: { role: string }) => user.role === 'CUSTOMER'))
})

test('password change signs out other devices', async () => {
  const stamp = Date.now()
  const email = `pw${stamp}@test.local`
  const first = new Client()
  assert.equal((await first.call('POST', '/auth/sign-up', { name: 'Password Tester', email, password: 'first-password' })).status, 201)
  const second = await signIn(email, 'first-password')

  assert.equal((await first.call('POST', '/auth/password', { currentPassword: 'wrong', newPassword: 'second-password' })).status, 400)
  assert.equal((await first.call('POST', '/auth/password', { currentPassword: 'first-password', newPassword: 'second-password' })).status, 204)
  assert.equal((await first.call('GET', '/auth/me')).status, 200, 'current device stays signed in')
  assert.equal((await second.call('GET', '/auth/me')).status, 401, 'other device is signed out')
  await signIn(email, 'second-password')
})
