import { HttpStatus, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { fail } from '../common/errors'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'

export type IncomingRecord = {
  collection: string
  key: string
  data?: unknown
  deleted: boolean
  updatedAt: string
}

const PAGE = 500

const wire = (r: { collection: string; key: string; data: Prisma.JsonValue; deleted: boolean; updatedAt: Date; rev: bigint }) => ({
  collection: r.collection,
  key: r.key,
  data: r.deleted ? null : r.data,
  deleted: r.deleted,
  updatedAt: r.updatedAt.toISOString(),
  rev: Number(r.rev),
})

/**
 * Offline-first sync for the Meri app. Each item is a record keyed by (collection, key).
 * Writes are last-writer-wins on the device's change time; every accepted write takes the user's next `rev`,
 * and clients pull everything after the last `rev` they saw.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async pull(userId: string, since: number) {
    const rows = await this.prisma.syncRecord.findMany({
      where: { userId, rev: { gt: BigInt(since) } },
      orderBy: { rev: 'asc' },
      take: PAGE + 1,
    })
    const more = rows.length > PAGE
    const page = rows.slice(0, PAGE)
    const state = await this.prisma.syncState.findUnique({ where: { userId } })
    return {
      records: page.map(wire),
      // Resume after the last record sent; when caught up, jump to the current head.
      cursor: more ? Number(page.at(-1)!.rev) : Number(state?.rev ?? 0n),
      more,
    }
  }

  async push(userId: string, records: IncomingRecord[]) {
    const now = Date.now()
    return this.prisma.$transaction(async (tx) => {
      // Locks this user's counter row, so concurrent pushes from two devices get distinct, ordered revs.
      await tx.syncState.upsert({ where: { userId }, create: { userId, rev: 0n }, update: {} })
      const accepted: { collection: string; key: string }[] = []
      const rejected: { collection: string; key: string }[] = []
      for (const r of records) {
        let changedAt = new Date(r.updatedAt)
        // A device with a wrong clock must not win forever: cap change times at "now".
        if (Number.isNaN(changedAt.getTime())) fail(HttpStatus.BAD_REQUEST, 'VALIDATION', 'Invalid updatedAt.')
        if (changedAt.getTime() > now) changedAt = new Date(now)
        const where = { userId_collection_key: { userId, collection: r.collection, key: r.key } }
        const existing = await tx.syncRecord.findUnique({ where, select: { updatedAt: true } })
        if (existing && existing.updatedAt > changedAt) {
          rejected.push({ collection: r.collection, key: r.key })
          continue
        }
        const { rev } = await tx.syncState.update({ where: { userId }, data: { rev: { increment: 1n } } })
        const data = r.deleted ? Prisma.DbNull : (r.data as Prisma.InputJsonValue)
        await tx.syncRecord.upsert({
          where,
          create: { userId, collection: r.collection, key: r.key, data, deleted: r.deleted, updatedAt: changedAt, rev },
          update: { data, deleted: r.deleted, updatedAt: changedAt, rev },
        })
        accepted.push({ collection: r.collection, key: r.key })
      }
      const state = await tx.syncState.findUniqueOrThrow({ where: { userId } })
      return { accepted, rejected, head: Number(state.rev) }
    })
  }

  // ── File contents ──

  private blobKey(userId: string, id: string) {
    return `meri-sync/${userId}/${id}`
  }

  async putBlob(userId: string, id: string, body: Buffer, mime: string) {
    const key = this.blobKey(userId, id)
    await this.storage.put(key, body, mime)
    await this.prisma.syncBlob.upsert({
      where: { userId_id: { userId, id } },
      create: { userId, id, key, mime, size: body.length },
      update: { mime, size: body.length },
    })
  }

  async getBlob(userId: string, id: string) {
    const blob = await this.prisma.syncBlob.findUnique({ where: { userId_id: { userId, id } } })
    if (!blob) fail(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'File not found.')
    const object = await this.storage.get(blob.key)
    return { ...object, mime: blob.mime, size: blob.size }
  }

  async listBlobs(userId: string) {
    return this.prisma.syncBlob.findMany({ where: { userId }, select: { id: true, size: true, mime: true } })
  }

  async deleteBlob(userId: string, id: string) {
    const blob = await this.prisma.syncBlob.findUnique({ where: { userId_id: { userId, id } } })
    if (!blob) return
    await this.storage.delete(blob.key).catch(() => undefined)
    await this.prisma.syncBlob.delete({ where: { userId_id: { userId, id } } })
  }
}
