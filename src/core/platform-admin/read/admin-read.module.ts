import { Module } from '@nestjs/common';
import { AdminReadController } from './admin-read.controller.js';
import { AdminOrganizationsService } from './admin-organizations.service.js';
import { AdminSubscriptionsService } from './admin-subscriptions.service.js';
import { AdminPaymentsService } from './admin-payments.service.js';
import { AdminMetricsService } from './admin-metrics.service.js';
import { AdminDailyMetricsService } from './admin-daily-metrics.service.js';
import { DailyMetricsSnapshotJob } from './daily-metrics-snapshot.job.js';

/**
 * Cross-tenant read surfaces for the platform-admin dashboard. PrismaService and
 * StorageService are global; the `admin-jwt` strategy backing AdminJwtAuthGuard
 * is registered by AdminAuthModule (passport strategies are process-global once
 * loaded), so no extra imports are required. ScheduleModule.forRoot() is global,
 * so DailyMetricsSnapshotJob's @Cron is picked up by registering it as a provider.
 */
@Module({
  controllers: [AdminReadController],
  providers: [
    AdminOrganizationsService,
    AdminSubscriptionsService,
    AdminPaymentsService,
    AdminMetricsService,
    AdminDailyMetricsService,
    DailyMetricsSnapshotJob,
  ],
})
export class AdminReadModule {}
