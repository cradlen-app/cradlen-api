import { Module } from '@nestjs/common';
import { VisitsModule } from '@core/clinical/visits/visits.public';
import { PatientAccessModule } from '@core/patient/patient-access/patient-access.public';
import { ValidatorModule } from '@builder/validator/validator.module';
import { ObgynModule } from '../obgyn.module';
import { PregnancyClinicalController } from './pregnancy-clinical.controller';
import { PregnancyClinicalService } from './pregnancy-clinical.service';
import { PregnancyActivationController } from './pregnancy-activation.controller';
import { PregnancyActivationService } from './pregnancy-activation.service';

/**
 * Pregnancy clinical vertical — activates the journey-centric chart for the
 * OBGYN_PREGNANCY care path. Imports VisitsModule for the EncounterMutationGuard
 * (closed-visit lock), PatientAccessModule for org-scope gating, ValidatorModule
 * for the template-driven PATCH validation, and ObgynModule for
 * ObgynHistoryService (the patient blood group on the read-only summary).
 */
@Module({
  imports: [VisitsModule, PatientAccessModule, ValidatorModule, ObgynModule],
  controllers: [PregnancyClinicalController, PregnancyActivationController],
  providers: [PregnancyClinicalService, PregnancyActivationService],
})
export class PregnancyModule {}
