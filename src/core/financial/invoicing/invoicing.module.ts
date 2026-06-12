import { Module } from '@nestjs/common';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { FinancialAccessModule } from '../shared/access/financial-access.module.js';
import { InvoicingController } from './invoicing.controller.js';
import { InvoicingService } from './invoicing.service.js';
import { InvoiceNumberService } from './invoice-number.service.js';
import { InvoiceBalanceService } from './invoice-balance.service.js';
import { InvoiceAccrualListener } from './invoice-accrual.listener.js';

@Module({
  imports: [AuthorizationModule, PricingModule, FinancialAccessModule],
  controllers: [InvoicingController],
  providers: [
    InvoicingService,
    InvoiceNumberService,
    InvoiceBalanceService,
    InvoiceAccrualListener,
  ],
  exports: [InvoicingService, InvoiceBalanceService],
})
export class InvoicingModule {}
