import { Module } from '@nestjs/common';
import { AdminNotificationsController } from './admin-notifications.controller.js';
import { AdminNotificationsService } from './admin-notifications.service.js';
import { AdminNotificationsListener } from './admin-notifications.listener.js';

/**
 * Admin notification feed + the event listener that materializes it. EventBus
 * and PrismaService are global; `@OnEvent` providers are auto-discovered once
 * registered here.
 */
@Module({
  controllers: [AdminNotificationsController],
  providers: [AdminNotificationsService, AdminNotificationsListener],
})
export class AdminNotificationsModule {}
