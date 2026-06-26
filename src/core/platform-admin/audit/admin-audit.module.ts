import { Module } from '@nestjs/common';
import { AdminAuditController } from './admin-audit.controller.js';
import { AdminAuditService } from './admin-audit.service.js';

/**
 * Shared platform-admin audit trail. Exports AdminAuditService so every admin
 * surface (auth set-password, admins management, write actions) records to the
 * same log; owns the read-only GET /v1/admin/audit-log controller.
 */
@Module({
  controllers: [AdminAuditController],
  providers: [AdminAuditService],
  exports: [AdminAuditService],
})
export class AdminAuditModule {}
