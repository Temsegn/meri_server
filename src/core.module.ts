import { Global, Module } from '@nestjs/common'
import { PrismaService } from './prisma/prisma.service'
import { StorageService } from './storage/storage.service'
import { MailService } from './mail/mail.service'
import { AuditService } from './audit/audit.service'
import { NotificationsService } from './notifications/notifications.service'

@Global()
@Module({
  providers: [PrismaService, StorageService, MailService, AuditService, NotificationsService],
  exports: [PrismaService, StorageService, MailService, AuditService, NotificationsService],
})
export class CoreModule {}
