import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { SpecialtiesModule } from '@core/org/specialties/specialties.public.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';

@Module({
  imports: [
    DatabaseModule,
    AuthorizationModule,
    SpecialtiesModule,
    SubscriptionsModule,
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
