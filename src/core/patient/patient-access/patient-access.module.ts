import { Module } from '@nestjs/common';
import { PatientAccessService } from './patient-access.service';

/**
 * Shares `PatientAccessService` (org-scoping patient/visit access gates) with
 * any module that imports it — currently `PatientsModule` and `ObgynModule`.
 */
@Module({
  providers: [PatientAccessService],
  exports: [PatientAccessService],
})
export class PatientAccessModule {}
