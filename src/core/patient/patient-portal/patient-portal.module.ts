import { Module } from '@nestjs/common';
import { PatientPortalController } from './patient-portal.controller.js';
import { PatientMedicationsService } from './patient-medications.service.js';
import { PatientVisitsService } from './patient-visits.service.js';
import { PatientInvestigationsService } from './patient-investigations.service.js';
import { PatientInvestigationResultsService } from './patient-investigation-results.service.js';
import { PatientProfileService } from './patient-profile.service.js';

/**
 * Patient-facing surface (authenticated via the `patient-jwt` strategy
 * registered by PatientAuthModule). Endpoints: profile settings, medications
 * list, visit history, investigations list, and patient-uploaded investigation
 * results (R2).
 */
@Module({
  controllers: [PatientPortalController],
  providers: [
    PatientMedicationsService,
    PatientVisitsService,
    PatientInvestigationsService,
    PatientInvestigationResultsService,
    PatientProfileService,
  ],
})
export class PatientPortalModule {}
