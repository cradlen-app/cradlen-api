import { Module } from '@nestjs/common';
import { PatientInvestigationsController } from './patient-investigations.controller.js';
import { PatientInvestigationsService } from './patient-investigations.service.js';
import { PatientInvestigationResultsService } from './patient-investigation-results.service.js';

/**
 * Patient-portal investigations surface: lab tests & imaging list +
 * patient-uploaded result files (R2 presigned PUT/GET).
 */
@Module({
  controllers: [PatientInvestigationsController],
  providers: [PatientInvestigationsService, PatientInvestigationResultsService],
})
export class PatientInvestigationsModule {}
