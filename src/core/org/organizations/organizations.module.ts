import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { AuthModule } from '@core/auth/auth.module.js';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { SpecialtyCatalogModule } from '@core/org/specialty-catalog/specialty-catalog.public.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';

@Module({
  imports: [
    DatabaseModule,
    // AuthModule provides TokensService + SessionsService for the @Public()
    // org-bootstrap route (a profile-less user creating their first org via
    // their login selection_token). No cycle: AuthModule imports nothing that
    // reaches OrganizationsModule.
    AuthModule,
    AuthorizationModule,
    SpecialtyCatalogModule,
    SubscriptionsModule,
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
