import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { PatientAccessModule } from '@core/patient/patient-access/patient-access.public.js';
import { PhiAuditService } from './phi-audit.service.js';
import { PhiAuditInterceptor } from './phi-audit.interceptor.js';
import { PhiAuditController } from './phi-audit.controller.js';

/**
 * Wires the PHI read-access audit trail. Registers `PhiAuditInterceptor`
 * globally (via APP_INTERCEPTOR) — it acts only on handlers annotated with
 * `@AuditsPhiAccess(...)`, so undecorated routes are unaffected. Also exposes
 * the OWNER-only "who accessed this patient" report. `PrismaService` is resolved
 * from the global `DatabaseModule`.
 */
@Module({
  imports: [AuthorizationModule, PatientAccessModule],
  controllers: [PhiAuditController],
  providers: [
    PhiAuditService,
    { provide: APP_INTERCEPTOR, useClass: PhiAuditInterceptor },
  ],
  exports: [PhiAuditService],
})
export class PhiAuditModule {}
