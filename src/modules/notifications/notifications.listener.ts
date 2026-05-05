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
        category: 'staff',
        title: 'Invitation Accepted',
        description: `${event.inviteeName} accepted your invitation.`,
        navigateTo: this.buildInvitationPath(event),
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
        category: 'staff',
        title: 'Invitation Declined',
        description: `${event.inviteeName} declined your invitation.`,
        navigateTo: this.buildInvitationPath(event),
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

  private buildInvitationPath(
    event: InvitationAcceptedEvent | InvitationDeclinedEvent,
  ): string {
    const base = `/${event.organizationId}`;
    const branch = event.branchId ? `/${event.branchId}` : '';
    return `${base}${branch}/dashboard/staff/invitations/${event.invitationId}`;
  }
}
