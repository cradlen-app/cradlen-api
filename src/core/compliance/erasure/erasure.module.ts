import { Module } from '@nestjs/common';
import { AdminAuditModule } from '@core/platform-admin/audit/admin-audit.module.js';
import { ErasureService } from './erasure.service.js';

/**
 * Patient anonymization (right-to-erasure). Platform-admin-triggered — wired
 * into AdminWriteModule. `AdminAuditModule` supplies the in-transaction audit
 * writer; `StorageService` (avatar delete) comes from the global StorageModule.
 */
@Module({
  imports: [AdminAuditModule],
  providers: [ErasureService],
  exports: [ErasureService],
})
export class ErasureModule {}
