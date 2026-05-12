import { Module } from '@nestjs/common';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { StaffController } from './staff.controller.js';
import { StaffService } from './staff.service.js';

@Module({
  imports: [DatabaseModule, AuthorizationModule, SubscriptionsModule],
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
