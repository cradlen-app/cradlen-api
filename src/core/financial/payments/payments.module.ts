import { Module } from '@nestjs/common';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { FinancialAccessModule } from '../shared/access/financial-access.module.js';
import { InvoicingModule } from '../invoicing/invoicing.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

@Module({
  imports: [AuthorizationModule, FinancialAccessModule, InvoicingModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
