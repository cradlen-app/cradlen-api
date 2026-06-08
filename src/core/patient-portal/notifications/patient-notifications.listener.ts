import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import {
  CLINICAL_EVENTS,
  type InvestigationReviewedEvent,
} from '@core/clinical/events/events.public.js';
import { PatientNotificationsService } from './patient-notifications.service.js';
import { PATIENT_NOTIFICATION_CODES } from './patient-notification-codes.js';

/**
 * Shape of the `visit.status_updated` event published by `visits.service`.
 * (Ad-hoc event — not in the clinical-events catalog — so the contract lives
 * here next to its only consumer.)
 */
interface VisitStatusUpdatedEvent {
  payload: { id: string; status: string };
}

@Injectable()
export class PatientNotificationsListener {
  private readonly logger = new Logger(PatientNotificationsListener.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly patientNotifications: PatientNotificationsService,
  ) {}

  /**
   * On visit completion, notify the patient about what they received during the
   * visit: a new prescription and/or newly ordered investigations (one
   * notification per type). Best-effort — never breaks visit completion.
   * COMPLETED is a terminal, one-way transition, so this fires once per visit.
   */
  @OnEvent('visit.status_updated')
  async handleVisitStatusUpdated(event: VisitStatusUpdatedEvent) {
    if (event.payload?.status !== 'COMPLETED') return;
    const visitId = event.payload.id;

    try {
      const visit = await this.prismaService.db.visit.findUnique({
        where: { id: visitId },
        select: {
          prescription: {
            select: {
              items: {
                where: { is_deleted: false },
                select: { id: true },
                take: 1,
              },
            },
          },
          investigations: {
            where: { is_deleted: false },
            select: { id: true },
            take: 1,
          },
          episode: {
            select: {
              journey: {
                select: { patient_id: true, organization_id: true },
              },
            },
          },
        },
      });

      const journey = visit?.episode?.journey;
      if (!visit || !journey) return;

      const hasPrescription = (visit.prescription?.items.length ?? 0) > 0;
      const hasInvestigations = visit.investigations.length > 0;

      if (hasPrescription) {
        await this.patientNotifications.create({
          patientId: journey.patient_id,
          organizationId: journey.organization_id,
          code: PATIENT_NOTIFICATION_CODES.VISIT_PRESCRIPTION_ISSUED.code,
          category:
            PATIENT_NOTIFICATION_CODES.VISIT_PRESCRIPTION_ISSUED.category,
          title:
            PATIENT_NOTIFICATION_CODES.VISIT_PRESCRIPTION_ISSUED.defaultTitle,
          description: 'Your doctor prescribed new medication for you.',
          navigateTo: '/medications',
          metadata: { visitId },
        });
      }

      if (hasInvestigations) {
        await this.patientNotifications.create({
          patientId: journey.patient_id,
          organizationId: journey.organization_id,
          code: PATIENT_NOTIFICATION_CODES.VISIT_INVESTIGATION_ORDERED.code,
          category:
            PATIENT_NOTIFICATION_CODES.VISIT_INVESTIGATION_ORDERED.category,
          title:
            PATIENT_NOTIFICATION_CODES.VISIT_INVESTIGATION_ORDERED.defaultTitle,
          description: 'Your doctor ordered new tests for you.',
          navigateTo: '/tests',
          metadata: { visitId },
        });
      }
    } catch (err) {
      this.logger.error(
        `Failed to create patient notifications for completed visit (visitId=${visitId})`,
        err,
      );
    }
  }

  /**
   * When a doctor reviews an investigation, notify the patient that their result
   * is ready (deep-links to the Tests screen, where the now-REVIEWED result is
   * visible). Best-effort — never breaks the review.
   */
  @OnEvent(CLINICAL_EVENTS.investigation.reviewed)
  async handleInvestigationReviewed(event: InvestigationReviewedEvent) {
    try {
      await this.patientNotifications.create({
        patientId: event.patient_id,
        organizationId: event.organization_id,
        code: PATIENT_NOTIFICATION_CODES.INVESTIGATION_REVIEWED.code,
        category: PATIENT_NOTIFICATION_CODES.INVESTIGATION_REVIEWED.category,
        title: PATIENT_NOTIFICATION_CODES.INVESTIGATION_REVIEWED.defaultTitle,
        description: `Your ${event.test_name} result has been reviewed.`,
        navigateTo: '/tests',
        metadata: {
          investigationId: event.investigation_id,
          visitId: event.visit_id,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to create patient notification for investigation.reviewed (investigationId=${event.investigation_id})`,
        err,
      );
    }
  }
}
