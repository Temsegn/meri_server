/**
 * Mobile app API against a running server: bearer-token auth, refresh rotation, offline-first sync, file blobs.
 *   npm run test:e2e
 */
import 'dotenv/config'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { API } from './http-client'

async function call(method: string, path: string, body?: unknown, token?: string, raw?: { data: Buffer; type: string }) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(raw ? { 'content-type': raw.type } : body ? { 'content-type': 'application/json' } : {}),
    },
    body: raw ? raw.data : body ? JSON.stringify(body) : undefined,
  })
  const type = res.headers.get('content-type') ?? ''
  const data = type.includes('application/json') ? await res.json() : Buffer.from(await res.arrayBuffer())
  return { status: res.status, data }
}

test('mobile sign-up, refresh and sync round trip', async () => {
  const stamp = Date.now()
  const email = `mobile${stamp}@test.local`
  const up = await call('POST', '/auth/mobile/sign-up', { name: 'Mobile Tester', email, password: 'correct-horse-1' })
  assert.equal(up.status, 201, JSON.stringify(up.data))
  assert.ok(up.data.accessToken && up.data.refreshToken)
  let token = up.data.accessToken as string

  assert.equal((await call('GET', '/auth/me', undefined, token)).data.user.email, email)
  assert.equal((await call('GET', '/sync/pull')).status, 401)

  // Refresh rotates; the old refresh token stops working.
  const refreshed = await call('POST', '/auth/mobile/refresh', { refreshToken: up.data.refreshToken })
  assert.equal(refreshed.status, 200)
  assert.notEqual(refreshed.data.refreshToken, up.data.refreshToken)
  assert.equal((await call('POST', '/auth/mobile/refresh', { refreshToken: up.data.refreshToken })).status, 401)
  token = refreshed.data.accessToken

  // Sign in with the same account from a "second device".
  const other = await call('POST', '/auth/mobile/sign-in', { email, password: 'correct-horse-1' })
  assert.equal(other.status, 200)

  // Push from device A, pull on device B.
  const t1 = new Date(Date.now() - 60_000).toISOString()
  const push = await call('POST', '/sync/push', {
    records: [
      { collection: 'habits', key: 'h1', data: { id: 'h1', name: 'Read' }, deleted: false, updatedAt: t1 },
      { collection: 'water', key: '2026-11-15', data: 4, deleted: false, updatedAt: t1 },
    ],
  }, token)
  assert.equal(push.status, 200, JSON.stringify(push.data))
  assert.equal(push.data.accepted.length, 2)

  const pulled = await call('GET', '/sync/pull?since=0', undefined, other.data.accessToken)
  assert.equal(pulled.data.records.length, 2)
  const cursor = pulled.data.cursor

  // Older change loses (last writer wins), newer change and deletions win.
  const stale = await call('POST', '/sync/push', { records: [{ collection: 'habits', key: 'h1', data: { id: 'h1', name: 'Old' }, deleted: false, updatedAt: new Date(Date.now() - 3_600_000).toISOString() }] }, other.data.accessToken)
  assert.equal(stale.data.rejected.length, 1)
  await call('POST', '/sync/push', { records: [{ collection: 'habits', key: 'h1', deleted: true, updatedAt: new Date().toISOString() }] }, other.data.accessToken)
  const delta = await call('GET', `/sync/pull?since=${cursor}`, undefined, token)
  assert.equal(delta.data.records.length, 1)
  assert.equal(delta.data.records[0].deleted, true)

  // Another user can't see this data.
  const stranger = await call('POST', '/auth/mobile/sign-up', { name: 'Someone Else', email: `other${stamp}@test.local`, password: 'correct-horse-1' })
  assert.equal((await call('GET', '/sync/pull?since=0', undefined, stranger.data.accessToken)).data.records.length, 0)

  // File blobs round trip.
  const bytes = Buffer.from('hello meri files')
  assert.equal((await call('PUT', '/sync/blobs/file_1', undefined, token, { data: bytes, type: 'text/plain' })).status, 204)
  const got = await call('GET', '/sync/blobs/file_1', undefined, other.data.accessToken)
  assert.equal(got.status, 200)
  assert.equal(Buffer.compare(got.data as Buffer, bytes), 0)
  assert.equal((await call('GET', '/sync/blobs/file_1', undefined, stranger.data.accessToken)).status, 404)
  assert.equal((await call('DELETE', '/sync/blobs/file_1', undefined, token)).status, 204)

  // Assistant needs sign-in, and reports whether it's configured.
  assert.equal((await call('GET', '/assistant/status')).status, 401)
  assert.equal(typeof (await call('GET', '/assistant/status', undefined, token)).data.enabled, 'boolean')

  // Sign-out revokes the refresh token.
  await call('POST', '/auth/mobile/sign-out', { refreshToken: refreshed.data.refreshToken })
  assert.equal((await call('POST', '/auth/mobile/refresh', { refreshToken: refreshed.data.refreshToken })).status, 401)
})

test('google endpoint rejects a forged token', async () => {
  const res = await call('POST', '/auth/mobile/google', { idToken: 'x'.repeat(40) })
  assert.ok([401, 503].includes(res.status), String(res.status))
})
