import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { z } from 'zod'
import { CurrentUser, Staff, type AuthUser } from '../common/auth.decorators'
import { ZodPipe } from '../common/zod.pipe'
import { SubscriptionsService } from './subscriptions.service'

const requestSchema = z.object({
  plan: z.enum(['SIX_MONTHS', 'ONE_YEAR']),
  method: z.enum(['TELEBIRR', 'CBE', 'ABYSSINIA']),
  receiptFileId: z.string().min(1).max(60),
})
const listSchema = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() })
const rejectSchema = z.object({ reason: z.string().trim().min(3, 'Tell the customer why.').max(300) })

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Get('plans')
  plans() {
    return this.subs.catalog()
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.subs.status(user.userId)
  }

  /** After uploading the receipt to /files/receipts. Stays PENDING until an admin reviews it. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  request(@CurrentUser() user: AuthUser, @Body(new ZodPipe(requestSchema)) body: z.infer<typeof requestSchema>) {
    return this.subs.request(user.userId, body)
  }
}

@Staff()
@Controller('admin/subscriptions')
export class AdminSubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Get()
  list(@Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>) {
    return this.subs.list(query.status)
  }

  @HttpCode(200)
  @Post(':id/approve')
  approve(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    return this.subs.approve(id, admin.userId)
  }

  @HttpCode(200)
  @Post(':id/reject')
  reject(@CurrentUser() admin: AuthUser, @Param('id') id: string, @Body(new ZodPipe(rejectSchema)) body: z.infer<typeof rejectSchema>) {
    return this.subs.reject(id, admin.userId, body.reason)
  }
}
