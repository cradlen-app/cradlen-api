import { Module } from '@nestjs/common';
import { FinancialServicesModule } from './services/services.module.js';
import { PricingModule } from './pricing/pricing.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';

@Module({
  imports: [FinancialServicesModule, PricingModule, InvoicesModule],
})
export class FinancialModule {}
