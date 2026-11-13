import { HttpStatus, Injectable } from '@nestjs/common'
import { Prisma, type OrderType } from '@prisma/client'
import { fail, notFound } from '../common/errors'
import { isInstagramTarget, isYoutubeTarget, normalizeTarget } from '../common/targets'
import { PrismaService } from '../prisma/prisma.service'
import { REF_PREFIX } from './order-rules'
import type { CreateOrderInput } from './order-schemas'
import { orderInclude, toOrder } from './order.mapper'

const TARGET_RULES: Partial<Record<OrderType, { test: (value: string) => boolean; message: string }>> = {
  YOUTUBE_SUBSCRIBERS: { test: isYoutubeTarget, message: 'Enter a YouTube channel link or @handle.' },
  INSTAGRAM_FOLLOWERS: { test: isInstagramTarget, message: 'Enter an Instagram @username or profile link.' },
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async listMine(userId: string) {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: orderInclude,
    })
    return orders.map(toOrder)
  }

  async getMine(userId: string, id: string) {
    const order = await this.prisma.order.findFirst({ where: { id, userId }, include: orderInclude })
    return order ? toOrder(order) : notFound('Order')
  }

  async create(userId: string, input: CreateOrderInput) {
    const data = await this.buildOrder(userId, input)
    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const ref = await nextRef(tx, input.type)
        return tx.order.create({
          data: { ...data, ref, userId, events: { create: { to: 'PENDING', actorId: userId } } },
          include: orderInclude,
        })
      })
      return toOrder(order)
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        fail(HttpStatus.CONFLICT, 'RECEIPT_USED', 'This receipt is already attached to another order.', {
          receiptFileId: 'Upload a new receipt.',
        })
      }
      throw error
    }
  }

  private async buildOrder(userId: string, input: CreateOrderInput) {
    if (input.type === 'ACCOUNT_SALE') {
      return {
        type: input.type,
        target: input.profileUrl,
        targetNormalized: normalizeTarget(input.profileUrl),
        amountEtb: input.askingPriceEtb,
        details: { platform: input.platform, name: input.name, audience: input.audience, phone: input.phone },
      }
    }

    await this.assertReceipt(userId, input.receiptFileId)

    if (input.type === 'ACCOUNT_PURCHASE') {
      const listing = await this.prisma.listing.findFirst({ where: { id: input.listingId, status: 'PUBLISHED' } })
      if (!listing) fail(HttpStatus.BAD_REQUEST, 'LISTING_UNAVAILABLE', 'This account is no longer available.')
      const reserved = await this.prisma.order.count({
        where: { listingId: listing.id, type: 'ACCOUNT_PURCHASE', status: { in: ['ACCEPTED', 'IN_PROGRESS'] } },
      })
      if (reserved) fail(HttpStatus.CONFLICT, 'LISTING_RESERVED', 'Another buyer is already purchasing this account.')
      return {
        type: input.type,
        target: listing.profileUrl,
        targetNormalized: normalizeTarget(listing.profileUrl),
        amountEtb: listing.priceEtb,
        listingId: listing.id,
        paymentMethod: input.paymentMethod,
        receiptFileId: input.receiptFileId,
      }
    }

    const rule = TARGET_RULES[input.type]
    if (rule && !rule.test(input.target)) {
      fail(HttpStatus.BAD_REQUEST, 'VALIDATION', rule.message, { target: rule.message })
    }
    const pkg = await this.prisma.package.findFirst({ where: { id: input.packageId, type: input.type, active: true } })
    if (!pkg) fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'Choose a valid package.', { packageId: 'Choose a package.' })

    return {
      type: input.type,
      target: input.target,
      targetNormalized: normalizeTarget(input.target),
      quantity: pkg.quantity,
      watchHours: pkg.watchHours,
      amountEtb: pkg.priceEtb, // price always comes from the server
      packageId: pkg.id,
      paymentMethod: input.paymentMethod,
      receiptFileId: input.receiptFileId,
    }
  }

  private async assertReceipt(userId: string, fileId: string) {
    const file = await this.prisma.file.findFirst({ where: { id: fileId, ownerId: userId }, include: { order: true } })
    if (!file) fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'Attach your payment receipt.', { receiptFileId: 'Upload your receipt.' })
    if (file.order) fail(HttpStatus.CONFLICT, 'RECEIPT_USED', 'This receipt is already attached to another order.')
  }
}

/** Human order reference, e.g. YT-00042, from a per-type counter. */
async function nextRef(tx: Prisma.TransactionClient, type: OrderType) {
  const prefix = REF_PREFIX[type]
  const counter = await tx.counter.upsert({
    where: { key: `order:${prefix}` },
    create: { key: `order:${prefix}`, value: 1 },
    update: { value: { increment: 1 } },
  })
  return `${prefix}-${String(counter.value).padStart(5, '0')}`
}
