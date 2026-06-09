import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ChargeSource } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
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
import {
  FINANCIAL_EVENTS,
  type ChargeCapturedEvent,
} from '@core/financial/financial.public.js';

@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly prismaService: PrismaService,
  ) {}

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

  @OnEvent(FINANCIAL_EVENTS.charge.captured)
  async handleChargeCaptured(event: ChargeCapturedEvent) {
    // Only notify the front desk when a doctor adds a service in the visit
    // workspace; reception-entered charges should not self-notify.
    if (event.source !== ChargeSource.DOCTOR) return;

    try {
      const receptionists = await this.prismaService.db.profile.findMany({
        where: {
          organization_id: event.organization_id,
          is_active: true,
          is_deleted: false,
          job_functions: {
            some: { job_function: { code: 'RECEPTIONIST' } },
          },
          branches: { some: { branch_id: event.branch_id } },
        },
        select: { id: true },
      });
      if (receptionists.length === 0) return;

      const [patient, doctor, service] = await Promise.all([
        this.prismaService.db.patient.findUnique({
          where: { id: event.patient_id },
          select: { full_name: true },
        }),
        this.prismaService.db.profile.findUnique({
          where: { id: event.captured_by_id },
          select: { user: { select: { first_name: true, last_name: true } } },
        }),
        event.service_id
          ? this.prismaService.db.service.findUnique({
              where: { id: event.service_id },
              select: { name: true },
            })
          : Promise.resolve(null),
      ]);

      const doctorName = doctor
        ? `Dr. ${doctor.user.first_name} ${doctor.user.last_name}`
        : 'A doctor';
      const patientName = patient?.full_name ?? 'a patient';
      const serviceLabel = service?.name
        ? `"${service.name}"`
        : 'a service charge';
      const branchPath = `/${event.branch_id}`;
      const navigateTo = event.visit_id
        ? `/${event.organization_id}${branchPath}/dashboard/visits/${event.visit_id}`
        : `/${event.organization_id}${branchPath}/dashboard/patients/${event.patient_id}`;

      await Promise.all(
        receptionists.map((receptionist) =>
          this.notificationsService.create({
            profileId: receptionist.id,
            code: NOTIFICATION_CODES.SERVICE_CHARGE_ADDED.code,
            category: NOTIFICATION_CODES.SERVICE_CHARGE_ADDED.category,
            title: NOTIFICATION_CODES.SERVICE_CHARGE_ADDED.defaultTitle,
            description: `${doctorName} added ${serviceLabel} for ${patientName}.`,
            navigateTo,
            metadata: {
              chargeId: event.charge_id,
              patientId: event.patient_id,
              branchId: event.branch_id,
              serviceId: event.service_id,
            },
          }),
        ),
      );
    } catch (err) {
      this.logger.error(
        `Failed to notify reception for charge.captured (chargeId=${event.charge_id})`,
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
