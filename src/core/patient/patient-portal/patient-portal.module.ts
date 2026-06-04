import { Module } from '@nestjs/common';
import { PatientPortalController } from './patient-portal.controller.js';
import { PatientMedicationsService } from './patient-medications.service.js';

/**
 * Patient-facing read surface (authenticated via the `patient-jwt` strategy
 * registered by PatientAuthModule). First endpoint: the medications list.
 */
@Module({
  controllers: [PatientPortalController],
  providers: [PatientMedicationsService],
})
export class PatientPortalModule {}
