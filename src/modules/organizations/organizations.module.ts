import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';

@Module({
  imports: [DatabaseModule, AuthorizationModule, SubscriptionsModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
})
export class OrganizationsModule {}
