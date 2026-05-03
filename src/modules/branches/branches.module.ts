import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';
import { DatabaseModule } from '../../database/database.module.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { BranchesController } from './branches.controller.js';
import { BranchesService } from './branches.service.js';

@Module({
  imports: [DatabaseModule, AuthorizationModule, SubscriptionsModule],
  controllers: [BranchesController],
  providers: [BranchesService],
})
export class BranchesModule {}
