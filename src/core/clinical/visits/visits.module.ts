import { Module } from '@nestjs/common';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';
import { EncounterMutationGuard } from './encounter-mutation.guard';
import { ValidatorModule } from '@builder/validator/validator.module.js';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { ChargingModule } from '@core/financial/charging/charging.module.js';

@Module({
  imports: [ValidatorModule, AuthorizationModule, ChargingModule],
  controllers: [VisitsController],
  providers: [VisitsService, EncounterMutationGuard],
  exports: [EncounterMutationGuard, VisitsService],
})
export class VisitsModule {}
