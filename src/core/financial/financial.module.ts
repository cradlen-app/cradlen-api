import { Module } from '@nestjs/common';
import { CatalogModule } from './catalog/catalog.module.js';
import { PricingModule } from './pricing/pricing.module.js';
import { ChargingModule } from './charging/charging.module.js';
import { InvoicingModule } from './invoicing/invoicing.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { RefundsModule } from './refunds/refunds.module.js';
import { ReceiptsModule } from './receipts/receipts.module.js';
import { CashManagementModule } from './cash-management/cash-management.module.js';
import { ReportingModule } from './reporting/reporting.module.js';

@Module({
  imports: [
    CatalogModule,
    PricingModule,
    ChargingModule,
    InvoicingModule,
    PaymentsModule,
    RefundsModule,
    ReceiptsModule,
    CashManagementModule,
    ReportingModule,
  ],
})
export class FinancialModule {}
