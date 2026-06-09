import { Module } from '@nestjs/common';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { CashManagementController } from './cash-management.controller.js';
import { CashManagementService } from './cash-management.service.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [CashManagementController],
  providers: [CashManagementService],
  exports: [CashManagementService],
})
export class CashManagementModule {}
