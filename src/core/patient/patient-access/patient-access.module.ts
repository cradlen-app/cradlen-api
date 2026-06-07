import { Module } from '@nestjs/common';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { PatientAccessService } from './patient-access.service';

/**
 * Shares `PatientAccessService` (org + branch scoping patient/visit access
 * gates) with any module that imports it — currently `PatientsModule` and
 * `ObgynModule`.
 */
@Module({
  imports: [AuthorizationModule],
  providers: [PatientAccessService],
  exports: [PatientAccessService],
})
export class PatientAccessModule {}
