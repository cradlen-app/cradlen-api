import { Module } from '@nestjs/common';
import { PatientPortalController } from './patient-portal.controller.js';
import { PatientMedicationsService } from './patient-medications.service.js';
import { PatientVisitsService } from './patient-visits.service.js';
import { PatientInvestigationsService } from './patient-investigations.service.js';

/**
 * Patient-facing read surface (authenticated via the `patient-jwt` strategy
 * registered by PatientAuthModule). Endpoints: medications list, visit history,
 * investigations list.
 */
@Module({
  controllers: [PatientPortalController],
  providers: [
    PatientMedicationsService,
    PatientVisitsService,
    PatientInvestigationsService,
  ],
})
export class PatientPortalModule {}
