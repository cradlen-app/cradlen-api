import { Module } from '@nestjs/common';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { PatientAccessModule } from '@core/patient/patient-access/patient-access.public.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { InvoicingModule } from '../invoicing/invoicing.module.js';
import { ChargingController } from './charging.controller.js';
import { ChargingService } from './charging.service.js';

@Module({
  imports: [
    AuthorizationModule,
    PricingModule,
    PatientAccessModule,
    InvoicingModule,
  ],
  controllers: [ChargingController],
  providers: [ChargingService],
  exports: [ChargingService],
})
export class ChargingModule {}
