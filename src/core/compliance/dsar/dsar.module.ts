import { Module } from '@nestjs/common';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { PatientAccessModule } from '@core/patient/patient-access/patient-access.public.js';
import { PhiAuditModule } from '../phi-audit/phi-audit.module.js';
import { PatientExportService } from './patient-export.service.js';
import { DsarController } from './dsar.controller.js';

/**
 * Data-subject-access / portability. Reuses AuthorizationService (OWNER gate),
 * PatientAccessService (org-scope), and PhiAuditService (the export is an
 * audited PHI read).
 */
@Module({
  imports: [AuthorizationModule, PatientAccessModule, PhiAuditModule],
  controllers: [DsarController],
  providers: [PatientExportService],
})
export class DsarModule {}
