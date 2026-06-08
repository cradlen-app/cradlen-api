import { Module } from '@nestjs/common';
import { PatientVisitsController } from './patient-visits.controller.js';
import { PatientVisitsService } from './patient-visits.service.js';

/** Patient-portal visits surface: completed history + upcoming follow-ups. */
@Module({
  controllers: [PatientVisitsController],
  providers: [PatientVisitsService],
})
export class PatientVisitsModule {}
