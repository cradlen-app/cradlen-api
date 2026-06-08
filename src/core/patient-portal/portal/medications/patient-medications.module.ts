import { Module } from '@nestjs/common';
import { PatientMedicationsController } from './patient-medications.controller.js';
import { PatientMedicationsService } from './patient-medications.service.js';

/** Patient-portal medications surface: prescribed drugs (current + past). */
@Module({
  controllers: [PatientMedicationsController],
  providers: [PatientMedicationsService],
})
export class PatientMedicationsModule {}
