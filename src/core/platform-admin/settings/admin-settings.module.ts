import { Module } from '@nestjs/common';
import { AdminSettingsController } from './admin-settings.controller.js';
import { AdminSettingsService } from './admin-settings.service.js';

/**
 * Platform settings surface for the admin console. PrismaService is global and
 * the `admin-jwt` strategy is registered by AdminAuthModule, so no imports are
 * needed.
 */
@Module({
  controllers: [AdminSettingsController],
  providers: [AdminSettingsService],
  exports: [AdminSettingsService],
})
export class AdminSettingsModule {}
