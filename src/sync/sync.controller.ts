import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req, Res } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { CurrentUser, type AuthUser } from '../common/auth.decorators'
import { fail } from '../common/errors'
import { ZodPipe } from '../common/zod.pipe'
import { SyncService } from './sync.service'

const name = z.string().min(1).max(120).regex(/^[A-Za-z0-9_.:-]+$/, 'Invalid name.')
const pushSchema = z.object({
  records: z
    .array(
      z.object({
        collection: z.string().min(1).max(40).regex(/^[A-Za-z][A-Za-z0-9]*$/),
        key: z.string().min(1).max(200),
        data: z.unknown().optional(),
        deleted: z.boolean().default(false),
        updatedAt: z.string().datetime({ offset: true }),
      }),
    )
    .max(500),
})
const pullSchema = z.object({ since: z.coerce.number().int().min(0).default(0) })

const MAX_BLOB = 25 * 1024 * 1024

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('pull')
  pull(@CurrentUser() user: AuthUser, @Query(new ZodPipe(pullSchema)) query: z.infer<typeof pullSchema>) {
    return this.sync.pull(user.userId, query.since)
  }

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(200)
  @Post('push')
  push(@CurrentUser() user: AuthUser, @Body(new ZodPipe(pushSchema)) body: z.infer<typeof pushSchema>) {
    return this.sync.push(user.userId, body.records)
  }

  @Get('blobs')
  async blobs(@CurrentUser() user: AuthUser) {
    return { blobs: await this.sync.listBlobs(user.userId) }
  }

  /** Raw file bytes in the body (parsed by the raw-body middleware registered in main.ts). */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(204)
  @Put('blobs/:id')
  async putBlob(@CurrentUser() user: AuthUser, @Param('id', new ZodPipe(name)) id: string, @Req() req: Request) {
    const body = req.body as unknown
    if (!Buffer.isBuffer(body) || body.length === 0) fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'Send the file bytes as the request body.')
    if (body.length > MAX_BLOB) fail(HttpStatus.PAYLOAD_TOO_LARGE, 'TOO_LARGE', 'Files can be up to 25 MB.')
    const mime = (req.headers['content-type'] ?? 'application/octet-stream').split(';')[0].slice(0, 120)
    await this.sync.putBlob(user.userId, id, body, mime)
  }

  @Get('blobs/:id')
  async getBlob(@CurrentUser() user: AuthUser, @Param('id', new ZodPipe(name)) id: string, @Res() res: Response) {
    const blob = await this.sync.getBlob(user.userId, id)
    res.setHeader('content-type', blob.mime)
    res.setHeader('content-length', String(blob.size))
    res.setHeader('cache-control', 'private, no-store')
    blob.body.pipe(res)
  }

  @HttpCode(204)
  @Delete('blobs/:id')
  deleteBlob(@CurrentUser() user: AuthUser, @Param('id', new ZodPipe(name)) id: string) {
    return this.sync.deleteBlob(user.userId, id)
  }
}
