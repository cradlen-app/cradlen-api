import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service.js';
import { NOTIFICATION_CODES } from './notification-codes.js';
import {
  InvitationAcceptedEvent,
  InvitationDeclinedEvent,
} from '@core/org/invitations/invitations.public.js';
import {
  CLINICAL_EVENTS,
  type InvestigationResultUploadedEvent,
} from '@core/clinical/events/events.public.js';

@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent('invitation.accepted')
  async handleInvitationAccepted(event: InvitationAcceptedEvent) {
    try {
      await this.notificationsService.create({
        profileId: event.recipientProfileId,
        code: NOTIFICATION_CODES.INVITATION_ACCEPTED.code,
        category: NOTIFICATION_CODES.INVITATION_ACCEPTED.category,
        title: NOTIFICATION_CODES.INVITATION_ACCEPTED.defaultTitle,
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
        profileId: event.recipientProfileId,
        code: NOTIFICATION_CODES.INVITATION_DECLINED.code,
        category: NOTIFICATION_CODES.INVITATION_DECLINED.category,
        title: NOTIFICATION_CODES.INVITATION_DECLINED.defaultTitle,
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

  @OnEvent(CLINICAL_EVENTS.investigation.resultUploaded)
  async handleInvestigationResultUploaded(
    event: InvestigationResultUploadedEvent,
  ) {
    try {
      const branch = event.branch_id ? `/${event.branch_id}` : '';
      await this.notificationsService.create({
        profileId: event.ordered_by_id,
        code: NOTIFICATION_CODES.INVESTIGATION_RESULT_UPLOADED.code,
        category: NOTIFICATION_CODES.INVESTIGATION_RESULT_UPLOADED.category,
        title: NOTIFICATION_CODES.INVESTIGATION_RESULT_UPLOADED.defaultTitle,
        description: `${event.patient_name} uploaded a result for ${event.test_name}.`,
        navigateTo: `/${event.organization_id}${branch}/dashboard/visits/${event.visit_id}`,
        metadata: {
          investigationId: event.investigation_id,
          visitId: event.visit_id,
          patientId: event.patient_id,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to create notification for investigation.result_uploaded (investigationId=${event.investigation_id})`,
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
