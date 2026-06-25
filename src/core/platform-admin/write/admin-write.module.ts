import { Module } from '@nestjs/common';
import { SubscriptionsModule } from '@core/org/subscriptions/subscriptions.module.js';
import { AdminWriteController } from './admin-write.controller.js';
import { AdminWriteService } from './admin-write.service.js';
import { AdminAuditController } from '../audit/admin-audit.controller.js';
import { AdminAuditService } from '../audit/admin-audit.service.js';

/**
 * Platform-admin write surfaces + the audit trail. Imports SubscriptionsModule
 * to reuse SubscriptionsService (activate / cache-bust) and
 * SubscriptionPaymentsService (verify / reject) rather than re-implementing the
 * subscription lifecycle. The `admin-jwt` strategy backing the guards is
 * registered by AdminAuthModule.
 */
@Module({
  imports: [SubscriptionsModule],
  controllers: [AdminWriteController, AdminAuditController],
  providers: [AdminWriteService, AdminAuditService],
})
export class AdminWriteModule {}
