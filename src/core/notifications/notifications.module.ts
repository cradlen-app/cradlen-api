import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsListener } from './notifications.listener.js';
import { NotificationsService } from './notifications.service.js';
import { PushController } from './push.controller.js';
import { PushService } from './push.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [NotificationsController, PushController],
  providers: [NotificationsService, NotificationsListener, PushService],
})
export class NotificationsModule {}
