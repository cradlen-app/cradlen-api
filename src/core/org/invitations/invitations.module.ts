import { Module } from '@nestjs/common';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { EmailModule } from '@infrastructure/email/email.module.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';

@Module({
  imports: [
    DatabaseModule,
    AuthorizationModule,
    EmailModule,
    SubscriptionsModule,
  ],
  controllers: [InvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
