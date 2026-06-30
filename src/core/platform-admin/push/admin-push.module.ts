import { Global, Module } from '@nestjs/common';
import { AdminPushController } from './admin-push.controller.js';
import { AdminPushService } from './admin-push.service.js';

/**
 * Admin Web Push: subscription endpoints + the fan-out service. Global so
 * AdminNotificationsService can inject AdminPushService to push on every new
 * notification, mirroring the global EmailModule. PrismaService is global.
 */
@Global()
@Module({
  controllers: [AdminPushController],
  providers: [AdminPushService],
  exports: [AdminPushService],
})
export class AdminPushModule {}
