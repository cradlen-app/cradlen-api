import { Module } from '@nestjs/common';
import { PatientProfileController } from './patient-profile.controller.js';
import { PatientProfileService } from './patient-profile.service.js';

/** Patient-portal profile surface: demographics + avatar (R2). */
@Module({
  controllers: [PatientProfileController],
  providers: [PatientProfileService],
})
export class PatientProfileModule {}
