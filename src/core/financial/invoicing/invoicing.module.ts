import { Module } from '@nestjs/common';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { FinancialAccessModule } from '../shared/access/financial-access.module.js';
import { InvoicingController } from './invoicing.controller.js';
import { InvoicingService } from './invoicing.service.js';
import { InvoiceNumberService } from './invoice-number.service.js';
import { InvoiceBalanceService } from './invoice-balance.service.js';
import { InvoiceAutoAppendListener } from './invoice-auto-append.listener.js';

@Module({
  imports: [AuthorizationModule, PricingModule, FinancialAccessModule],
  controllers: [InvoicingController],
  providers: [
    InvoicingService,
    InvoiceNumberService,
    InvoiceBalanceService,
    InvoiceAutoAppendListener,
  ],
  exports: [InvoiceBalanceService],
})
export class InvoicingModule {}
