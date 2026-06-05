import { Module } from '@nestjs/common';
import { PatientAccessModule } from '@core/patient/patient-access/patient-access.module.js';
import { InvestigationsController } from './investigations.controller.js';
import { InvestigationsService } from './investigations.service.js';

/**
 * Staff/doctor investigation review surface: read a single investigation (with
 * patient-uploaded result files) and record the review (mark REVIEWED + notes).
 * The patient ordering/uploading lives under `core/patient/patient-portal`.
 */
@Module({
  imports: [PatientAccessModule],
  controllers: [InvestigationsController],
  providers: [InvestigationsService],
})
export class InvestigationsModule {}
