import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import type { Response } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { CurrentUser, Public, isStaff, type AuthUser } from '../common/auth.decorators'
import { fail, notFound } from '../common/errors'
import { ZodPipe } from '../common/zod.pipe'
import { NotificationsService } from '../notifications/notifications.service'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import { createOrderSchema, orderTypeSchema, type CreateOrderInput } from './order-schemas'
import { OrdersService } from './orders.service'

const MAX_RECEIPT_BYTES = 8 * 1024 * 1024

/** Detect the real file type from its first bytes — never trust the browser's content type. */
function sniff(buffer: Buffer): { mime: string; ext: string } | null {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { mime: 'image/jpeg', ext: 'jpg' }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' }
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' }
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' }
  return null
}

@Controller()
export class ShopController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  @Public()
  @Get('health')
  health() {
    return { ok: true }
  }

  // ── Catalog ──
  @Public()
  @Get('packages')
  async packages(@Query('type', new ZodPipe(orderTypeSchema.optional())) type?: z.infer<typeof orderTypeSchema>) {
    const items = await this.prisma.package.findMany({
      where: { active: true, ...(type ? { type } : {}) },
      orderBy: [{ type: 'asc' }, { quantity: 'asc' }],
      select: { id: true, type: true, quantity: true, priceEtb: true, watchHours: true, popular: true },
    })
    return { items }
  }

  @Public()
  @Get('listings')
  async listings() {
    const items = await this.prisma.listing.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, platform: true, name: true, profileUrl: true, audience: true, includes: true, priceEtb: true },
    })
    return { items }
  }

  // ── Receipts (Cloudflare R2) ──
  @Post('files/receipts')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_RECEIPT_BYTES, files: 1 } }))
  async uploadReceipt(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'Choose a receipt file.', { file: 'Choose a file.' })
    const type = sniff(file.buffer)
    if (!type) fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'Receipts must be a JPG, PNG, WebP or PDF.', { file: 'Unsupported file type.' })

    const key = `receipts/${user.userId}/${randomUUID()}.${type.ext}`
    await this.storage.put(key, file.buffer, type.mime)
    const name = file.originalname.replace(/[^\w.\- ()]/g, '_').slice(0, 120) || `receipt.${type.ext}`
    const saved = await this.prisma.file.create({
      data: { key, name, mime: type.mime, size: file.size, ownerId: user.userId },
      select: { id: true, name: true, mime: true, size: true },
    })
    return saved
  }

  /** Redirects to a 5-minute signed URL. Only the owner or an admin may open a file. */
  @Get('files/:id')
  async openFile(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const file = await this.prisma.file.findUnique({ where: { id } })
    if (!file || (file.ownerId !== user.userId && !isStaff(user.role))) return notFound('File')
    res.setHeader('Cache-Control', 'no-store')
    res.redirect(302, await this.storage.signedUrl(file.key, file.name))
  }

  // ── Orders ──
  @Get('orders')
  async myOrders(@CurrentUser() user: AuthUser) {
    return { items: await this.orders.listMine(user.userId) }
  }

  @Get('orders/:id')
  async myOrder(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.getMine(user.userId, id)
  }

  @Post('orders')
  async createOrder(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createOrderSchema)) body: CreateOrderInput) {
    return this.orders.create(user.userId, body)
  }

  // ── Notifications ──
  @Get('notifications')
  notificationsList(@CurrentUser() user: AuthUser) {
    return this.notifications.listForUser(user.userId)
  }

  @HttpCode(204)
  @Post('notifications/read-all')
  async readAll(@CurrentUser() user: AuthUser) {
    await this.notifications.markRead(user.userId)
  }

  @HttpCode(204)
  @Post('notifications/:id/read')
  async readOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.notifications.markRead(user.userId, id)
  }
}
