import { Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { CoreModule } from './core.module'
import { AuthModule } from './auth/auth.module'
import { AuthGuard } from './auth/auth.guard'
import { HttpExceptionFilter } from './common/http-exception.filter'
import { OrdersService } from './orders/orders.service'
import { ShopController } from './orders/shop.controller'
import { AdminController } from './admin/admin.controller'
import { AdminOrdersService } from './admin/admin-orders.service'
import { AdminOverviewController } from './admin/admin-overview.controller'
import { AdminCatalogController } from './admin/admin-catalog.controller'
import { AdminTeamController } from './admin/admin-team.controller'
import { BoostController } from './boost/boost.controller'
import { SyncController } from './sync/sync.controller'
import { SyncService } from './sync/sync.service'
import { AssistantController } from './assistant/assistant.controller'
import { AssistantService } from './assistant/assistant.service'
import { GeminiClient } from './assistant/gemini.client'

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]), CoreModule, AuthModule],
  controllers: [ShopController, AdminController, AdminOverviewController, AdminCatalogController, AdminTeamController, BoostController, SyncController, AssistantController],
  providers: [
    OrdersService,
    AdminOrdersService,
    SyncService,
    AssistantService,
    GeminiClient,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
