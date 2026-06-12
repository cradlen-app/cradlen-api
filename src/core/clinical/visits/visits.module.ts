import { Module } from '@nestjs/common';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';
import { VisitStatusService } from './visit-status.service';
import { EncounterMutationGuard } from './encounter-mutation.guard';
import { ValidatorModule } from '@builder/validator/validator.module.js';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { ChargingModule } from '@core/financial/charging/charging.module.js';
import { InvoicingModule } from '@core/financial/invoicing/invoicing.module.js';

@Module({
  imports: [
    ValidatorModule,
    AuthorizationModule,
    ChargingModule,
    InvoicingModule,
  ],
  controllers: [VisitsController],
  providers: [VisitsService, VisitStatusService, EncounterMutationGuard],
  exports: [EncounterMutationGuard, VisitsService, VisitStatusService],
})
export class VisitsModule {}
