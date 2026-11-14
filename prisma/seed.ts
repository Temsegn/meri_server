/**
 * Seeds the catalog and the super admin (always), plus a complete demo dataset
 * (when SEED_DEMO=true and no demo users exist yet): staff, customers, ~90 days of orders
 * with receipts, status history, deliveries, notifications and an audit trail.
 * Safe to run repeatedly: catalog rows are upserted, demo data is only inserted once.
 */
import 'dotenv/config'
import { createHash, randomUUID } from 'node:crypto'
import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { PrismaClient, type OrderStatus, type OrderType, type Platform, type Role } from '@prisma/client'
import { hash } from '@node-rs/argon2'

const prisma = new PrismaClient()
const DAY = 86_400_000
const HOUR = 3_600_000
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * HOUR)

// Deterministic randomness so every fresh seed looks the same.
let seedState = 20261113
const rand = () => {
  seedState = (seedState + 0x6d2b79f5) | 0
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
}
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]
function weighted<T extends string>(weights: Partial<Record<T, number>>): T {
  const entries = Object.entries(weights) as [T, number][]
  let roll = rand() * entries.reduce((sum, [, weight]) => sum + weight, 0)
  for (const [value, weight] of entries) if ((roll -= weight) <= 0) return value
  return entries[entries.length - 1][0]
}

// ─────────────────────────── Catalog ───────────────────────────

/** quantity → price (ETB). Instagram and promotion prices are placeholders — edit before launch. */
const PACKAGES: Record<'YOUTUBE_SUBSCRIBERS' | 'INSTAGRAM_FOLLOWERS', [number, number][]> = {
  YOUTUBE_SUBSCRIBERS: [[20, 350], [50, 750], [100, 1400], [200, 2600], [300, 3750], [500, 5750], [600, 6750], [700, 7700], [900, 9300], [1000, 10000]],
  INSTAGRAM_FOLLOWERS: [[100, 600], [250, 1450], [500, 2750], [600, 3250], [900, 4600], [1000, 5000]],
}
const POPULAR: Partial<Record<OrderType, number>> = { YOUTUBE_SUBSCRIBERS: 500, INSTAGRAM_FOLLOWERS: 500 }

const LISTINGS = [
  { key: 'travel', platform: 'YOUTUBE', name: 'Travel Stories', profileUrl: 'https://youtube.com/@travelstories_sample', audience: '12,400 subscribers', includes: '1 channel', priceEtb: 24000 },
  { key: 'quickbites', platform: 'TIKTOK', name: 'QuickBites Studio', profileUrl: 'https://tiktok.com/@quickbites_sample', audience: '28,500 followers', includes: '1 profile', priceEtb: 18500 },
  { key: 'community', platform: 'TELEGRAM', name: 'Creator Community', profileUrl: 'https://t.me/creatorcommunity_sample', audience: '8,200 members', includes: '1 channel · 1 group', priceEtb: 12000 },
  { key: 'fitness', platform: 'INSTAGRAM', name: 'Daily Fitness ET', profileUrl: 'https://instagram.com/dailyfitness_sample', audience: '15,900 followers', includes: '1 profile', priceEtb: 21000 },
  { key: 'tech', platform: 'YOUTUBE', name: 'Tech Review Hub', profileUrl: 'https://youtube.com/@techreviewhub_sample', audience: '31,200 subscribers', includes: '1 channel', priceEtb: 52000 },
  { key: 'music', platform: 'TELEGRAM', name: 'Ethio Music Daily', profileUrl: 'https://t.me/ethiomusic_sample', audience: '19,000 members', includes: '1 channel', priceEtb: 16000 },
  { key: 'gaming', platform: 'YOUTUBE', name: 'Habesha Gaming', profileUrl: 'https://youtube.com/@habeshagaming_sample', audience: '22,800 subscribers', includes: '1 channel', priceEtb: 38000 },
  { key: 'recipes', platform: 'INSTAGRAM', name: 'Injera & More', profileUrl: 'https://instagram.com/injeraandmore_sample', audience: '9,400 followers', includes: '1 profile', priceEtb: 11000 },
  { key: 'comedy', platform: 'TIKTOK', name: 'Addis Laughs', profileUrl: 'https://tiktok.com/@addislaughs_sample', audience: '64,000 followers', includes: '1 profile', priceEtb: 45000 },
] as const
type ListingKey = (typeof LISTINGS)[number]['key']

// ─────────────────────────── Demo people ───────────────────────────

const DEMO_DOMAIN = 'demo.meriboost.local'

const STAFF: { key: string; name: string; role: Role }[] = [
  { key: 'selam', name: 'Selam Girma', role: 'ADMIN' }, // operations
  { key: 'yonas', name: 'Yonas Bekele', role: 'ADMIN' }, // support
]

const CUSTOMERS = [
  { key: 'ava', name: 'Ava Morgan', days: 88 },
  { key: 'noah', name: 'Noah Kim', days: 85 },
  { key: 'maya', name: 'Maya Patel', days: 80 },
  { key: 'abebe', name: 'Abebe Kebede', days: 76 },
  { key: 'hana', name: 'Hana Tesfaye', days: 70 },
  { key: 'dawit', name: 'Dawit Alemu', days: 66, suspended: true },
  { key: 'liya', name: 'Liya Haile', days: 61 },
  { key: 'samuel', name: 'Samuel Tadesse', days: 57 },
  { key: 'meron', name: 'Meron Assefa', days: 52 },
  { key: 'kidus', name: 'Kidus Worku', days: 47 },
  { key: 'bethel', name: 'Bethel Mekonnen', days: 41 },
  { key: 'eyob', name: 'Eyob Desta', days: 36 },
  { key: 'ruth', name: 'Ruth Getachew', days: 30 },
  { key: 'leo', name: 'Leo Fischer', days: 26 },
  { key: 'sara', name: 'Sara Yilma', days: 21 },
  { key: 'nahom', name: 'Nahom Berhane', days: 17 },
  { key: 'tigist', name: 'Tigist Lemma', days: 12, suspended: true },
  { key: 'omar', name: 'Omar Hassan', days: 9 },
  { key: 'feven', name: 'Feven Abera', days: 5 },
  { key: 'isaac', name: 'Isaac Mulugeta', days: 2 },
] as const
type CustomerKey = (typeof CUSTOMERS)[number]['key']

type DemoOrder = {
  customer: CustomerKey
  type: OrderType
  status: OrderStatus
  days: number
  target?: string
  quantity?: number
  listing?: ListingKey
  sale?: { platform: Platform; name: string; audience: string; askingPriceEtb: number }
  delivered?: number
  rejectionReason?: string
  payment?: string
}

/** Hand-written orders covering every stage of every service. */
const CURATED: DemoOrder[] = [
  { customer: 'ava', type: 'YOUTUBE_SUBSCRIBERS', status: 'COMPLETED', days: 28, target: '@avatravels', quantity: 100, delivered: 100 },
  { customer: 'noah', type: 'YOUTUBE_SUBSCRIBERS', status: 'IN_PROGRESS', days: 6, target: 'https://youtube.com/@noahcooks', quantity: 200, delivered: 65 },
  { customer: 'abebe', type: 'YOUTUBE_SUBSCRIBERS', status: 'ACCEPTED', days: 2, target: '@abebetech', quantity: 300 },
  { customer: 'hana', type: 'YOUTUBE_SUBSCRIBERS', status: 'PENDING', days: 0, target: '@hanavlogs', quantity: 500, payment: 'CBE' },
  { customer: 'maya', type: 'YOUTUBE_SUBSCRIBERS', status: 'PENDING', days: 1, target: 'https://youtube.com/@mayacreates', quantity: 100, payment: 'Bank of Abyssinia' },
  { customer: 'dawit', type: 'YOUTUBE_SUBSCRIBERS', status: 'REJECTED', days: 9, target: '@dawitgames', quantity: 700, rejectionReason: 'The receipt amount (ETB 1,150) does not match the package price of ETB 11,500.' },

  { customer: 'maya', type: 'INSTAGRAM_FOLLOWERS', status: 'COMPLETED', days: 20, target: '@maya.creates', quantity: 100, delivered: 100 },
  { customer: 'ava', type: 'INSTAGRAM_FOLLOWERS', status: 'IN_PROGRESS', days: 4, target: '@ava.travels', quantity: 250, delivered: 80 },
  { customer: 'hana', type: 'INSTAGRAM_FOLLOWERS', status: 'ACCEPTED', days: 1, target: 'https://instagram.com/hana.style', quantity: 100 },
  { customer: 'abebe', type: 'INSTAGRAM_FOLLOWERS', status: 'PENDING', days: 0, target: '@abebe.shots', quantity: 500, payment: 'CBE' },
  { customer: 'noah', type: 'INSTAGRAM_FOLLOWERS', status: 'REJECTED', days: 12, target: '@noah.private', quantity: 100, rejectionReason: 'The profile is private. Make it public and place the order again.' },


  { customer: 'abebe', type: 'ACCOUNT_PURCHASE', status: 'COMPLETED', days: 18, listing: 'music' },
  { customer: 'samuel', type: 'ACCOUNT_PURCHASE', status: 'COMPLETED', days: 44, listing: 'recipes', payment: 'CBE' },
  { customer: 'maya', type: 'ACCOUNT_PURCHASE', status: 'IN_PROGRESS', days: 3, listing: 'community', payment: 'CBE' },
  { customer: 'noah', type: 'ACCOUNT_PURCHASE', status: 'PENDING', days: 0, listing: 'quickbites' },
  { customer: 'omar', type: 'ACCOUNT_PURCHASE', status: 'PENDING', days: 1, listing: 'gaming', payment: 'Bank of Abyssinia' },

  { customer: 'hana', type: 'ACCOUNT_SALE', status: 'COMPLETED', days: 16, target: 'https://youtube.com/@hanabakes_sample', sale: { platform: 'YOUTUBE', name: 'Hana Bakes', audience: '9,800 subscribers', askingPriceEtb: 19000 } },
  { customer: 'ava', type: 'ACCOUNT_SALE', status: 'PENDING', days: 1, target: 'https://tiktok.com/@avadance_sample', sale: { platform: 'TIKTOK', name: 'Ava Dance', audience: '42,000 followers', askingPriceEtb: 35000 } },
  { customer: 'kidus', type: 'ACCOUNT_SALE', status: 'IN_PROGRESS', days: 4, target: 'https://instagram.com/kidus.shoots_sample', sale: { platform: 'INSTAGRAM', name: 'Kidus Shoots', audience: '13,300 followers', askingPriceEtb: 17500 } },
  { customer: 'noah', type: 'ACCOUNT_SALE', status: 'REJECTED', days: 7, target: 'https://t.me/noahdeals_sample', sale: { platform: 'TELEGRAM', name: 'Noah Deals', audience: '1,200 members', askingPriceEtb: 25000 }, rejectionReason: 'We could not verify ownership of this channel. Contact support with an admin screenshot.' },
]

const REJECTIONS = [
  'The receipt amount does not match the package price.',
  'The receipt is unreadable. Upload a clearer photo of the transfer.',
  'The channel link does not open. Check the link and order again.',
  'The profile is private. Make it public and place the order again.',
  'This payment reference was already used for another order.',
]

/** Generated history: more recent days get more orders, so the dashboard shows growth. */
function generatedOrders(count: number): DemoOrder[] {
  const active = CUSTOMERS.filter((customer) => !('suspended' in customer))
  const orders: DemoOrder[] = []
  for (let n = 0; n < count; n++) {
    const days = Math.floor(89 * Math.pow(rand(), 1.35))
    const customer = pick(active.filter((c) => c.days >= days))
    const type = weighted<OrderType>({ YOUTUBE_SUBSCRIBERS: 56, INSTAGRAM_FOLLOWERS: 36, ACCOUNT_SALE: 8 })
    const status =
      days > 14
        ? weighted<OrderStatus>({ COMPLETED: 82, REJECTED: 12, IN_PROGRESS: 6 })
        : days > 4
          ? weighted<OrderStatus>({ COMPLETED: 40, IN_PROGRESS: 30, ACCEPTED: 14, REJECTED: 10, PENDING: 6 })
          : weighted<OrderStatus>({ PENDING: 42, ACCEPTED: 24, IN_PROGRESS: 22, REJECTED: 12 })
    const handle = `${customer.key}${n}`
    const rejectionReason = status === 'REJECTED' ? pick(REJECTIONS) : undefined
    const payment = pick(['Telebirr', 'Telebirr', 'CBE', 'Bank of Abyssinia'])

    if (type === 'ACCOUNT_SALE') {
      const platform = pick<Platform>(['YOUTUBE', 'INSTAGRAM', 'TIKTOK', 'TELEGRAM'])
      const url = { YOUTUBE: `https://youtube.com/@${handle}_sample`, INSTAGRAM: `https://instagram.com/${handle}_sample`, TIKTOK: `https://tiktok.com/@${handle}_sample`, TELEGRAM: `https://t.me/${handle}_sample` }[platform]
      const audience = `${(2 + Math.floor(rand() * 40)) * 1000} ${platform === 'YOUTUBE' ? 'subscribers' : platform === 'TELEGRAM' ? 'members' : 'followers'}`
      orders.push({ customer: customer.key, type, status: status === 'COMPLETED' ? 'REJECTED' : status, days, target: url, rejectionReason: status === 'COMPLETED' || status === 'REJECTED' ? pick(REJECTIONS.slice(2)) : undefined, sale: { platform, name: `${customer.name.split(' ')[0]}'s ${platform === 'TELEGRAM' ? 'Channel' : 'Studio'}`, audience, askingPriceEtb: (8 + Math.floor(rand() * 40)) * 1000 } })
      continue
    }

    const quantity = type === 'YOUTUBE_SUBSCRIBERS' ? pick([100, 100, 200, 200, 300, 500]) : pick([100, 100, 250, 250, 500])
    const target =
      type === 'YOUTUBE_SUBSCRIBERS' ? (rand() < 0.5 ? `@${handle}` : `https://youtube.com/@${handle}`) : `@${customer.key}.${n}`
    const delivered =
      status === 'COMPLETED' ? quantity : status === 'IN_PROGRESS' ? Math.round(quantity * (0.2 + rand() * 0.6)) : undefined
    orders.push({ customer: customer.key, type, status, days, target, quantity, delivered, rejectionReason, payment })
  }
  return orders
}

// ─────────────────────────── Helpers ───────────────────────────

const STAGE_PATH: OrderStatus[] = ['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED']
const PREFIX: Record<OrderType, string> = { YOUTUBE_SUBSCRIBERS: 'YT', INSTAGRAM_FOLLOWERS: 'IG', CHANNEL_PROMOTION: 'CH', ACCOUNT_PURCHASE: 'AB', ACCOUNT_SALE: 'AS' }
const TYPE_LABEL: Record<OrderType, string> = { YOUTUBE_SUBSCRIBERS: 'YouTube subscriber', INSTAGRAM_FOLLOWERS: 'Instagram follower', CHANNEL_PROMOTION: 'Channel promotion', ACCOUNT_PURCHASE: 'Account purchase', ACCOUNT_SALE: 'Account sale' }
const STATUS_LABEL: Record<OrderStatus, string> = { PENDING: 'pending review', ACCEPTED: 'accepted', IN_PROGRESS: 'in progress', COMPLETED: 'completed', REJECTED: 'rejected' }
const DELIVERY_PLATFORM: Partial<Record<OrderType, Platform>> = { YOUTUBE_SUBSCRIBERS: 'YOUTUBE', INSTAGRAM_FOLLOWERS: 'INSTAGRAM' }

function normalizeTarget(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^(www\.|m\.)/, '')
    .replace(/^(youtube\.com\/|youtu\.be\/|instagram\.com\/|tiktok\.com\/|t\.me\/)/, '')
    .replace(/[?#].*$/, '').replace(/\/(videos|featured|shorts|streams|about|reels)?\/*$/, '').replace(/^@/, '')
}

// 1×1 PNG used as the demo receipt image.
const RECEIPT_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

function storage() {
  const { S3_ENDPOINT, S3_REGION = 'auto', S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) throw new Error('S3_* settings are required to seed receipts')
  const client = new S3Client({ region: S3_REGION, endpoint: S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY } })
  return {
    async ensureBucket() {
      if (process.env.S3_CREATE_BUCKET !== 'true') return
      try {
        await client.send(new HeadBucketCommand({ Bucket: S3_BUCKET }))
      } catch {
        await client.send(new CreateBucketCommand({ Bucket: S3_BUCKET }))
      }
    },
    put: (key: string) => client.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: RECEIPT_PNG, ContentType: 'image/png' })),
  }
}

async function nextRef(type: OrderType) {
  const key = `order:${PREFIX[type]}`
  const counter = await prisma.counter.upsert({ where: { key }, create: { key, value: 1 }, update: { value: { increment: 1 } } })
  return `${PREFIX[type]}-${String(counter.value).padStart(5, '0')}`
}

/** A past (revoked) session so the team page can show "last active". */
const pastSession = (userId: string, lastUsedAt: Date) => ({
  userId,
  refreshTokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
  userAgent: 'Seed',
  expiresAt: lastUsedAt,
  revokedAt: lastUsedAt,
  createdAt: lastUsedAt,
  lastUsedAt,
})

// ─────────────────────────── Main ───────────────────────────

async function main() {
  const adminEmail = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase()
  const adminPassword = process.env.ADMIN_PASSWORD ?? ''
  if (!adminEmail || adminPassword.length < 12) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (12+ chars)')

  // The account from the environment is always the super admin.
  const superAdmin = await prisma.user.upsert({
    where: { email: adminEmail },
    create: { email: adminEmail, name: process.env.ADMIN_NAME ?? 'Super Admin', role: 'SUPER_ADMIN', passwordHash: await hash(adminPassword) },
    update: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
  })
  console.log(`✓ super admin: ${adminEmail}`)

  for (const [type, rows] of Object.entries(PACKAGES) as [OrderType, [number, number][]][]) {
    for (const [quantity, priceEtb] of rows) {
      await prisma.package.upsert({
        where: { type_quantity: { type, quantity } },
        // New YouTube packages come with free watch hours: 1 up to 300 subscribers, 2 from 500.
        create: { type, quantity, priceEtb, popular: POPULAR[type] === quantity, watchHours: type === 'YOUTUBE_SUBSCRIBERS' ? (quantity <= 300 ? 1 : 2) : 0 },
        update: {},
      })
    }
  }
  // Free watch hours on YouTube packages: 1 hour up to 300 subscribers, 2 hours from 500. Set once; admins can change them.
  if (!(await prisma.package.count({ where: { type: 'YOUTUBE_SUBSCRIBERS', watchHours: { gt: 0 } } }))) {
    await prisma.package.updateMany({ where: { type: 'YOUTUBE_SUBSCRIBERS', quantity: { lte: 300 } }, data: { watchHours: 1 } })
    await prisma.package.updateMany({ where: { type: 'YOUTUBE_SUBSCRIBERS', quantity: { gte: 500 } }, data: { watchHours: 2 } })
  }

  // Channel promotion is no longer offered: hide any packages left from older seeds (orders keep their history).
  await prisma.package.updateMany({ where: { type: 'CHANNEL_PROMOTION' }, data: { active: false, popular: false } })
  console.log('✓ catalog: packages')

  if (process.env.SEED_DEMO !== 'true') return console.log('SEED_DEMO is off — catalog only.')
  if (await prisma.user.count({ where: { email: { endsWith: `@${DEMO_DOMAIN}` } } })) {
    return console.log('Demo data already present — skipped. Reset the database to start over.')
  }

  const s3 = storage()
  await s3.ensureBucket()
  const demoPassword = process.env.DEMO_PASSWORD ?? 'Demo-password-1'
  const passwordHash = await hash(demoPassword)

  // Staff
  const staff = [superAdmin]
  for (const member of STAFF) {
    staff.push(await prisma.user.create({ data: { email: `${member.key}@${DEMO_DOMAIN}`, name: member.name, role: member.role, passwordHash, createdAt: ago(89) } }))
  }
  await prisma.session.createMany({ data: staff.map((user, index) => pastSession(user.id, ago(0, 1 + index * 5))) })
  const staffActor = () => pick(staff).id

  // Marketplace listings (sold by the super admin account)
  const listings = new Map<string, Awaited<ReturnType<typeof prisma.listing.create>>>()
  for (const { key, ...listing } of LISTINGS) {
    listings.set(key, await prisma.listing.create({ data: { ...listing, platform: listing.platform as Platform, status: 'PUBLISHED', sellerId: superAdmin.id, createdAt: ago(80) } }))
  }

  // Delivery email pool: 1–500 YouTube + Instagram, 501–600 YouTube only, the last few switched off.
  await prisma.deliveryEmail.createMany({
    data: Array.from({ length: 600 }, (_, index) => ({
      address: `boost${String(index + 1).padStart(3, '0')}@delivery.${DEMO_DOMAIN}`,
      platforms: (index < 500 ? ['YOUTUBE', 'INSTAGRAM'] : ['YOUTUBE']) as Platform[],
      active: index < 592,
      createdAt: ago(85),
    })),
  })
  const pool = await prisma.deliveryEmail.findMany({ where: { active: true }, orderBy: { address: 'asc' }, select: { id: true, platforms: true } })
  console.log(`✓ demo: ${staff.length} staff, ${LISTINGS.length} listings, 600 delivery emails`)

  // Customers
  const users = new Map<CustomerKey, { id: string; email: string }>()
  for (const [index, customer] of CUSTOMERS.entries()) {
    const user = await prisma.user.create({
      data: {
        email: `${customer.key}@${DEMO_DOMAIN}`,
        name: customer.name,
        phone: `+2519110000${String(index + 1).padStart(2, '0')}`,
        passwordHash,
        status: 'suspended' in customer ? 'SUSPENDED' : 'ACTIVE',
        createdAt: ago(customer.days),
      },
    })
    users.set(customer.key, user)
    if ('suspended' in customer) {
      await prisma.auditLog.create({ data: { actorId: superAdmin.id, action: 'user.status', entity: 'User', entityId: user.id, data: { status: 'SUSPENDED' }, createdAt: ago(Math.max(0, customer.days - 3)) } })
    }
  }

  // Orders
  const packages = await prisma.package.findMany()
  const orders = [...CURATED, ...generatedOrders(120)].sort((a, b) => b.days - a.days)
  for (const spec of orders) {
    const user = users.get(spec.customer)!
    const createdAt = ago(spec.days, 1 + Math.floor(rand() * 10))
    const listing = spec.listing ? listings.get(spec.listing)! : null
    const pkg = spec.quantity ? packages.find((p) => p.type === spec.type && p.quantity === spec.quantity) : null
    const target = listing?.profileUrl ?? spec.target!
    const isSale = spec.type === 'ACCOUNT_SALE'

    // Receipt in object storage (not for sale requests — the seller is paid, not paying)
    let receiptFileId: string | undefined
    if (!isSale) {
      const key = `receipts/${user.id}/${randomUUID()}.png`
      await s3.put(key)
      const file = await prisma.file.create({ data: { key, name: `receipt-${spec.customer}-${spec.type.toLowerCase()}.png`, mime: 'image/png', size: RECEIPT_PNG.length, ownerId: user.id, createdAt } })
      receiptFileId = file.id
    }

    const order = await prisma.order.create({
      data: {
        ref: await nextRef(spec.type),
        type: spec.type,
        status: spec.status,
        userId: user.id,
        target,
        targetNormalized: normalizeTarget(target),
        quantity: pkg?.quantity ?? null,
        amountEtb: listing?.priceEtb ?? pkg?.priceEtb ?? spec.sale!.askingPriceEtb,
        paymentMethod: isSale ? null : (spec.payment ?? 'Telebirr'),
        details: spec.sale ? { ...spec.sale, phone: `+2519110000${String(CUSTOMERS.findIndex((c) => c.key === spec.customer) + 1).padStart(2, '0')}` } : undefined,
        rejectionReason: spec.rejectionReason ?? null,
        packageId: pkg?.id,
        listingId: listing?.id,
        receiptFileId,
        createdAt,
        updatedAt: createdAt,
      },
    })

    // Status history, audit trail and customer notifications, spaced out after creation (never in the future)
    const path = spec.status === 'REJECTED' ? (['PENDING', 'REJECTED'] as OrderStatus[]) : STAGE_PATH.slice(0, STAGE_PATH.indexOf(spec.status) + 1)
    const step = Math.min(10 * HOUR, (Date.now() - createdAt.getTime()) / path.length)
    let lastAt = createdAt
    for (const [index, to] of path.entries()) {
      const at = new Date(createdAt.getTime() + index * step)
      lastAt = at
      const actorId = index ? staffActor() : user.id
      await prisma.orderEvent.create({
        data: { orderId: order.id, from: index ? path[index - 1] : null, to, actorId, note: to === 'REJECTED' ? spec.rejectionReason : null, createdAt: at },
      })
      if (index === 0) continue
      await prisma.auditLog.create({ data: { actorId, action: 'order.status', entity: 'Order', entityId: order.id, data: { from: path[index - 1], to, force: false }, createdAt: at } })
      const reason = to === 'REJECTED' ? ` Reason: ${spec.rejectionReason}` : ''
      await prisma.notificationBatch.create({
        data: {
          kind: 'ORDER_UPDATE',
          audience: user.id,
          title: `Order ${order.ref} is ${STATUS_LABEL[to]}`,
          body: `Your ${TYPE_LABEL[spec.type].toLowerCase()} order for ${spec.sale?.name ?? listing?.name ?? target} is now ${STATUS_LABEL[to]}.${reason}`,
          orderId: order.id,
          recipients: 1,
          createdById: actorId,
          createdAt: at,
          // Older updates are read; the latest one per order stays unread.
          notifications: { create: { userId: user.id, createdAt: at, readAt: index < path.length - 1 ? at : null, emailedAt: at } },
        },
      })
    }
    await prisma.order.update({ where: { id: order.id }, data: { updatedAt: lastAt } })

    // Delivery emails (which email subscribed / followed). Targets differ per order, so emails can repeat across orders.
    const platform = DELIVERY_PLATFORM[spec.type]
    if (platform && spec.delivered) {
      const usable = pool.filter((email) => email.platforms.includes(platform)).slice(0, spec.delivered)
      await prisma.delivery.createMany({
        data: usable.map((email, index) => ({
          orderId: order.id,
          deliveryEmailId: email.id,
          platform,
          targetNormalized: order.targetNormalized,
          createdById: staff[1].id,
          createdAt: new Date(createdAt.getTime() + Math.min(DAY, step) + index * 1000),
        })),
      })
      await prisma.auditLog.create({ data: { actorId: staff[1].id, action: 'order.deliveries', entity: 'Order', entityId: order.id, data: { count: usable.length }, createdAt: lastAt } })
    }

    // Marketplace effects of completed account orders
    if (spec.status === 'COMPLETED' && listing) await prisma.listing.update({ where: { id: listing.id }, data: { status: 'SOLD' } })
    if (spec.status === 'COMPLETED' && spec.sale) {
      const published = await prisma.listing.create({
        data: { platform: spec.sale.platform, name: spec.sale.name, profileUrl: target, audience: spec.sale.audience, includes: '1 account', priceEtb: spec.sale.askingPriceEtb, status: 'PUBLISHED', sellerId: user.id, createdAt },
      })
      await prisma.order.update({ where: { id: order.id }, data: { listingId: published.id } })
    }
  }
  console.log(`✓ demo: ${CUSTOMERS.length} customers, ${orders.length} orders with receipts, history, deliveries`)

  // Admin broadcasts + one direct message
  const activeCustomers = CUSTOMERS.filter((c) => !('suspended' in c)).map((c) => ({ ...users.get(c.key)!, joined: c.days }))
  const broadcasts = [
    { days: 3, title: 'Holiday offer: 10% off subscriber packages', body: 'Order any YouTube subscriber package before the end of the month and we add 10% extra subscribers at no cost.' },
    { days: 40, title: 'Instagram followers are here', body: 'You can now order Instagram follower packages from your dashboard — same receipts, same tracking.' },
  ]
  for (const broadcast of broadcasts) {
    const recipients = activeCustomers.filter((customer) => customer.joined >= broadcast.days)
    const batch = await prisma.notificationBatch.create({
      data: {
        kind: 'MANUAL',
        audience: 'all',
        title: broadcast.title,
        body: broadcast.body,
        recipients: recipients.length,
        createdById: superAdmin.id,
        createdAt: ago(broadcast.days),
        notifications: { createMany: { data: recipients.map((user) => ({ userId: user.id, createdAt: ago(broadcast.days), readAt: broadcast.days > 10 ? ago(broadcast.days - 1) : null })) } },
      },
    })
    await prisma.auditLog.create({ data: { actorId: superAdmin.id, action: 'notification.send', entity: 'NotificationBatch', entityId: batch.id, data: { audience: 'all' }, createdAt: ago(broadcast.days) } })
  }
  const noah = users.get('noah')!
  await prisma.notificationBatch.create({
    data: {
      kind: 'MANUAL',
      audience: noah.id,
      title: 'Thanks for your order',
      body: 'Your subscriber order is complete. Reply to this email if you want a delivery report.',
      recipients: 1,
      createdById: staff[2].id,
      createdAt: ago(25),
      notifications: { create: { userId: noah.id, createdAt: ago(25), readAt: ago(24) } },
    },
  })
  console.log('✓ demo: notifications + audit trail')

  console.log(`
Seeded.
  Super admin : ${adminEmail}  (ADMIN_PASSWORD)
  Admins      : ${STAFF.map((s) => `${s.key}@${DEMO_DOMAIN}`).join(', ')}  (DEMO_PASSWORD)
  Customers   : ${CUSTOMERS.slice(0, 4).map((c) => `${c.key}@${DEMO_DOMAIN}`).join(', ')} … ${CUSTOMERS.length} in total  (DEMO_PASSWORD)`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
