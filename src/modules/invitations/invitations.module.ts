import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';
import { DatabaseModule } from '../../database/database.module.js';
import { MailModule } from '../mail/mail.module.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';

@Module({
  imports: [
    DatabaseModule,
    AuthorizationModule,
    MailModule,
    SubscriptionsModule,
  ],
  controllers: [InvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
