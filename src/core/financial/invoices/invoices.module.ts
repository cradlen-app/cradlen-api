import { Module } from '@nestjs/common';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { PricingModule } from '@core/financial/pricing/pricing.module.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { InvoiceNumberService } from './invoice-number.service.js';

@Module({
  imports: [AuthorizationModule, PricingModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceNumberService],
})
export class InvoicesModule {}
