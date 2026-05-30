import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { SpecialtyCatalogModule } from '@core/org/specialty-catalog/specialty-catalog.public.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';

@Module({
  imports: [
    DatabaseModule,
    AuthorizationModule,
    SpecialtyCatalogModule,
    SubscriptionsModule,
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
