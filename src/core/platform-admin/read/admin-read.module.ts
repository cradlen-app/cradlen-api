import { Module } from '@nestjs/common';
import { AdminReadController } from './admin-read.controller.js';
import { AdminOrganizationsService } from './admin-organizations.service.js';
import { AdminUsersService } from './admin-users.service.js';
import { AdminSubscriptionsService } from './admin-subscriptions.service.js';
import { AdminPaymentsService } from './admin-payments.service.js';
import { AdminMetricsService } from './admin-metrics.service.js';

/**
 * Cross-tenant read surfaces for the platform-admin dashboard. PrismaService and
 * StorageService are global; the `admin-jwt` strategy backing AdminJwtAuthGuard
 * is registered by AdminAuthModule (passport strategies are process-global once
 * loaded), so no extra imports are required.
 */
@Module({
  controllers: [AdminReadController],
  providers: [
    AdminOrganizationsService,
    AdminUsersService,
    AdminSubscriptionsService,
    AdminPaymentsService,
    AdminMetricsService,
  ],
})
export class AdminReadModule {}
