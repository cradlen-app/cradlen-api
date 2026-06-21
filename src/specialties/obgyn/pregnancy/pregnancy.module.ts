import { Module } from '@nestjs/common';
import { VisitsModule } from '@core/clinical/visits/visits.public';
import { PatientAccessModule } from '@core/patient/patient-access/patient-access.public';
import { ValidatorModule } from '@builder/validator/validator.module';
import { PregnancyClinicalController } from './pregnancy-clinical.controller';
import { PregnancyClinicalService } from './pregnancy-clinical.service';
import { PregnancyActivationController } from './pregnancy-activation.controller';
import { PregnancyActivationService } from './pregnancy-activation.service';

/**
 * Pregnancy clinical vertical — activates the journey-centric chart for the
 * OBGYN_PREGNANCY care path. Imports VisitsModule for the EncounterMutationGuard
 * (closed-visit lock), PatientAccessModule for org-scope gating, and
 * ValidatorModule for the template-driven PATCH validation.
 */
@Module({
  imports: [VisitsModule, PatientAccessModule, ValidatorModule],
  controllers: [PregnancyClinicalController, PregnancyActivationController],
  providers: [PregnancyClinicalService, PregnancyActivationService],
})
export class PregnancyModule {}
