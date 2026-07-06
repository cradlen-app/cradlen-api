import { Module } from '@nestjs/common';
import { SubscriptionsModule } from '@core/org/subscriptions/subscriptions.module.js';
import { ErasureModule } from '@core/compliance/erasure/erasure.module.js';
import { AdminWriteController } from './admin-write.controller.js';
import { AdminWriteService } from './admin-write.service.js';
import { AdminAuditModule } from '../audit/admin-audit.module.js';

/**
 * Platform-admin write surfaces. Imports SubscriptionsModule to reuse
 * SubscriptionsService (activate / cache-bust) and SubscriptionPaymentsService
 * (verify / reject), and AdminAuditModule for the shared audit trail. The
 * `admin-jwt` strategy backing the guards is registered by AdminAuthModule.
 */
@Module({
  imports: [SubscriptionsModule, AdminAuditModule, ErasureModule],
  controllers: [AdminWriteController],
  providers: [AdminWriteService],
})
export class AdminWriteModule {}
