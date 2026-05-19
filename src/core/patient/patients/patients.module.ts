import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { PatientEnrollmentCleanupService } from './patient-enrollment-cleanup.service.js';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { VisitsModule } from '@core/clinical/visits/visits.module.js';

@Module({
  imports: [AuthorizationModule, VisitsModule],
  controllers: [PatientsController],
  providers: [PatientsService, PatientEnrollmentCleanupService],
})
export class PatientsModule {}
