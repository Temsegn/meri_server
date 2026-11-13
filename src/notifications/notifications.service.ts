import { Injectable } from '@nestjs/common'
import type { NotificationKind } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../mail/mail.service'

type SendInput = {
  kind: NotificationKind
  /** "all" (every active customer) or a user id. */
  audience: string
  title: string
  body: string
  orderId?: string
  createdById?: string
  email: boolean
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async send(input: SendInput) {
    const recipients = await this.prisma.user.findMany({
      where:
        input.audience === 'all'
          ? { status: 'ACTIVE', role: 'CUSTOMER' }
          : { id: input.audience },
      select: { id: true, email: true },
    })

    const batch = await this.prisma.notificationBatch.create({
      data: {
        kind: input.kind,
        audience: input.audience,
        title: input.title,
        body: input.body,
        orderId: input.orderId,
        createdById: input.createdById,
        recipients: recipients.length,
        notifications: { createMany: { data: recipients.map((user) => ({ userId: user.id })) } },
      },
    })

    if (input.email) void this.emailBatch(batch.id, recipients, input.title, input.body)
    return batch
  }

  /** Emails run in the background so the admin request returns immediately. */
  private async emailBatch(batchId: string, recipients: { id: string; email: string }[], title: string, body: string) {
    for (const user of recipients) {
      if (await this.mail.send(user.email, title, body)) {
        await this.prisma.notification.updateMany({
          where: { batchId, userId: user.id },
          data: { emailedAt: new Date() },
        })
      }
    }
  }

  async listForUser(userId: string) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { batch: true },
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ])
    return {
      unread,
      items: items.map((item) => ({
        id: item.id,
        kind: item.batch.kind,
        title: item.batch.title,
        body: item.batch.body,
        orderId: item.batch.orderId,
        readAt: item.readAt,
        createdAt: item.createdAt,
      })),
    }
  }

  async markRead(userId: string, id?: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(id ? { id } : {}) },
      data: { readAt: new Date() },
    })
  }
}
