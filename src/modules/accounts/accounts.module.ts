import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';

@Module({
  imports: [DatabaseModule, AuthorizationModule, SubscriptionsModule],
  controllers: [AccountsController],
  providers: [AccountsService],
})
export class AccountsModule {}
