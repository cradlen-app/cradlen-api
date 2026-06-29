import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../auth/admin-auth.module.js';
import { AdminAuditModule } from '../audit/admin-audit.module.js';
import { AdminsController } from './admins.controller.js';
import { AdminsService } from './admins.service.js';

/**
 * In-app admin management. Imports AdminAuthModule (for AdminVerificationService
 * → set-password invites) and AdminAuditModule (shared audit trail). The
 * `admin-jwt` strategy backing the guard is registered by AdminAuthModule.
 */
@Module({
  imports: [AdminAuthModule, AdminAuditModule],
  controllers: [AdminsController],
  providers: [AdminsService],
})
export class AdminsModule {}
