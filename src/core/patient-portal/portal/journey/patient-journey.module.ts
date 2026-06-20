import { Module } from '@nestjs/common';
import { PatientJourneyController } from './patient-journey.controller.js';
import { PatientJourneyService } from './patient-journey.service.js';

/** Patient-portal journey surface: the active journey for the home dashboard. */
@Module({
  controllers: [PatientJourneyController],
  providers: [PatientJourneyService],
})
export class PatientJourneyModule {}
