import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isInstagramTarget, isYoutubeTarget, normalizeTarget } from '../src/common/targets'
import { canTransition } from '../src/orders/order-rules'

test('normalizeTarget matches the same channel typed differently', () => {
  const same = ['@MyChannel', 'https://www.youtube.com/@mychannel', 'youtube.com/@MyChannel/videos', 'https://m.youtube.com/@mychannel/?si=x']
  assert.deepEqual(new Set(same.map(normalizeTarget)), new Set(['mychannel']))
  assert.notEqual(normalizeTarget('youtube.com/channel/UC123'), normalizeTarget('youtube.com/channel/UC456'))
})

test('target validators', () => {
  assert.ok(isYoutubeTarget('@abc'))
  assert.ok(isYoutubeTarget('https://youtube.com/@abc'))
  assert.ok(!isYoutubeTarget('abc'))
  assert.ok(isInstagramTarget('@maya.creates'))
  assert.ok(isInstagramTarget('https://instagram.com/maya.creates/'))
  assert.ok(!isInstagramTarget('https://instagram.com/p/xyz/extra'))
})

test('status transitions', () => {
  assert.ok(canTransition('PENDING', 'ACCEPTED'))
  assert.ok(!canTransition('PENDING', 'COMPLETED'))
  assert.ok(canTransition('IN_PROGRESS', 'COMPLETED'))
  assert.ok(canTransition('REJECTED', 'PENDING'))
})
