import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service.js';
import { InvitationAcceptedEvent } from './events/invitation-accepted.event.js';
import { InvitationDeclinedEvent } from './events/invitation-declined.event.js';

@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent('invitation.accepted')
  async handleInvitationAccepted(event: InvitationAcceptedEvent) {
    try {
      await this.notificationsService.create({
        userId: event.inviterId,
        type: 'INVITATION_ACCEPTED',
        title: 'Invitation Accepted',
        body: `${event.inviteeName} accepted your invitation.`,
        metadata: {
          invitationId: event.invitationId,
          inviteeName: event.inviteeName,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to create notification for invitation.accepted (invitationId=${event.invitationId})`,
        err,
      );
    }
  }

  @OnEvent('invitation.declined')
  async handleInvitationDeclined(event: InvitationDeclinedEvent) {
    try {
      await this.notificationsService.create({
        userId: event.inviterId,
        type: 'INVITATION_DECLINED',
        title: 'Invitation Declined',
        body: `${event.inviteeName} declined your invitation.`,
        metadata: {
          invitationId: event.invitationId,
          inviteeName: event.inviteeName,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to create notification for invitation.declined (invitationId=${event.invitationId})`,
        err,
      );
    }
  }
}
