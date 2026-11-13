import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common'
import { z } from 'zod'
import { AuditService } from '../audit/audit.service'
import { CurrentUser, Staff, type AuthUser } from '../common/auth.decorators'
import { fail, notFound } from '../common/errors'
import { ZodPipe } from '../common/zod.pipe'
import { PrismaService } from '../prisma/prisma.service'

const platform = z.enum(['YOUTUBE', 'INSTAGRAM', 'TIKTOK', 'TELEGRAM'])
const price = z.coerce.number().int('Whole birr only.').min(1, 'Enter a price.').max(10_000_000)

const packageBody = z.object({
  type: z.enum(['YOUTUBE_SUBSCRIBERS', 'INSTAGRAM_FOLLOWERS']),
  quantity: z.coerce.number().int().min(1, 'Enter a quantity.').max(1_000_000),
  priceEtb: price,
  watchHours: z.coerce.number().int().min(0).max(1000).default(0),
  popular: z.boolean().default(false),
  active: z.boolean().default(true),
})
const packagePatch = z.object({
  priceEtb: price.optional(),
  watchHours: z.coerce.number().int().min(0).max(1000).optional(),
  popular: z.boolean().optional(),
  active: z.boolean().optional(),
})

const listingBody = z.object({
  platform,
  name: z.string().trim().min(2, 'Enter the account name.').max(80),
  profileUrl: z.string().trim().url('Enter the full profile link.').max(300),
  audience: z.string().trim().min(1, 'Enter the audience size.').max(60),
  includes: z.string().trim().min(1, 'Say what is included.').max(80),
  priceEtb: price,
  status: z.enum(['IN_REVIEW', 'PUBLISHED', 'SOLD', 'ARCHIVED']).default('PUBLISHED'),
})
const listingQuery = z.object({ status: z.enum(['IN_REVIEW', 'PUBLISHED', 'SOLD', 'ARCHIVED']).optional() })

/** Package prices and marketplace listings. Every change is audited. */
@Staff()
@Controller('admin')
export class AdminCatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Packages ──
  @Get('packages')
  async packages() {
    const rows = await this.prisma.package.findMany({
      orderBy: [{ type: 'asc' }, { quantity: 'asc' }],
      include: { _count: { select: { orders: true } } },
    })
    return { items: rows.map(({ _count, ...row }) => ({ ...row, orderCount: _count.orders })) }
  }

  @Post('packages')
  async createPackage(@CurrentUser() user: AuthUser, @Body(new ZodPipe(packageBody)) body: z.infer<typeof packageBody>) {
    if (await this.prisma.package.findUnique({ where: { type_quantity: { type: body.type, quantity: body.quantity } } })) {
      fail(HttpStatus.CONFLICT, 'PACKAGE_EXISTS', 'A package with this quantity already exists.', { quantity: 'Already exists.' })
    }
    const row = await this.prisma.$transaction(async (tx) => {
      if (body.popular) await tx.package.updateMany({ where: { type: body.type }, data: { popular: false } })
      return tx.package.create({ data: body })
    })
    await this.audit.log(user.userId, 'package.create', 'Package', row.id, body)
    return { ...row, orderCount: 0 }
  }

  @Patch('packages/:id')
  async patchPackage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(packagePatch)) body: z.infer<typeof packagePatch>) {
    const existing = await this.prisma.package.findUnique({ where: { id } })
    if (!existing) return notFound('Package')
    const row = await this.prisma.$transaction(async (tx) => {
      // Only one "most popular" badge per service.
      if (body.popular) await tx.package.updateMany({ where: { type: existing.type, id: { not: id } }, data: { popular: false } })
      return tx.package.update({ where: { id }, data: body })
    })
    await this.audit.log(user.userId, 'package.update', 'Package', id, body)
    return row
  }

  @HttpCode(204)
  @Delete('packages/:id')
  async deletePackage(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (await this.prisma.order.count({ where: { packageId: id } })) {
      fail(HttpStatus.CONFLICT, 'PACKAGE_IN_USE', 'Customers have ordered this package. Hide it instead of deleting it.')
    }
    await this.prisma.package.delete({ where: { id } })
    await this.audit.log(user.userId, 'package.delete', 'Package', id)
  }

  // ── Marketplace listings ──
  @Get('listings')
  async listings(@Query(new ZodPipe(listingQuery)) query: z.infer<typeof listingQuery>) {
    const [rows, grouped] = await Promise.all([
      this.prisma.listing.findMany({
        where: query.status ? { status: query.status } : {},
        orderBy: { createdAt: 'desc' },
        include: { seller: { select: { id: true, name: true, email: true } }, _count: { select: { orders: true } } },
      }),
      this.prisma.listing.groupBy({ by: ['status'], _count: { _all: true } }),
    ])
    const counts = { ALL: 0, IN_REVIEW: 0, PUBLISHED: 0, SOLD: 0, ARCHIVED: 0 }
    for (const row of grouped) {
      counts[row.status] = row._count._all
      counts.ALL += row._count._all
    }
    return { counts, items: rows.map(({ _count, ...row }) => ({ ...row, orderCount: _count.orders })) }
  }

  @Post('listings')
  async createListing(@CurrentUser() user: AuthUser, @Body(new ZodPipe(listingBody)) body: z.infer<typeof listingBody>) {
    const row = await this.prisma.listing.create({ data: { ...body, sellerId: user.userId } })
    await this.audit.log(user.userId, 'listing.create', 'Listing', row.id, { name: body.name })
    return row
  }

  @Patch('listings/:id')
  async patchListing(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(listingBody.partial())) body: Partial<z.infer<typeof listingBody>>,
  ) {
    const row = await this.prisma.listing.update({ where: { id }, data: body })
    await this.audit.log(user.userId, 'listing.update', 'Listing', id, body)
    return row
  }

  @HttpCode(204)
  @Delete('listings/:id')
  async deleteListing(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (await this.prisma.order.count({ where: { listingId: id } })) {
      fail(HttpStatus.CONFLICT, 'LISTING_IN_USE', 'This listing has orders. Archive it instead of deleting it.')
    }
    await this.prisma.listing.delete({ where: { id } })
    await this.audit.log(user.userId, 'listing.delete', 'Listing', id)
  }
}
