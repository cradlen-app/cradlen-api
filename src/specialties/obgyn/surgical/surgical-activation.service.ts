import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { ERROR_CODES } from '@common/constant/error-codes';
import { EventBus } from '@infrastructure/messaging/event-bus';
import {
  CLINICAL_EVENTS,
  JourneyCarePathSetEvent,
  PregnancyClosedEvent,
  SurgicalBookedEvent,
  SurgicalClosedEvent,
} from '@core/clinical/events/events.public';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.public';
import { buildRevision } from '../revisions.helper';
import { SURGICAL_CARE_PATH_CODE } from './surgical-care-path.guard';
import { SurgicalEpisodeRouterService } from './surgical-episode-router.service';
import {
  CloseSurgicalDto,
  CreateSurgicalDto,
  SurgicalProfileDto,
} from './dto/surgical-activation.dto';

/**
 * Lifecycle of a surgical profile: activation (the drawer's "Create") and
 * closing. Activation opens a NEW surgical journey — completing the visit's
 * current journey and re-pointing the visit onto the new journey's phase episode
 * (Pre-op by default, routed by surgery date) — and attaches an ACTIVE surgical
 * profile, which makes the descriptor declare the clinical surface so the
 * Surgical tab appears.
 *
 * Cesarean handoff: when the patient has an ACTIVE pregnancy journey, the drawer
 * must confirm closing it first. The pregnancy is closed (cesarean outcome) and
 * the surgical journey opens — cross-linked via `source_pregnancy_journey_id` —
 * all in one transaction. Closing records the outcome and completes the journey.
 */
@Injectable()
export class SurgicalActivationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly access: PatientAccessService,
    private readonly eventBus: EventBus,
    private readonly episodeRouter: SurgicalEpisodeRouterService,
  ) {}

  async activate(
    visitId: string,
    dto: CreateSurgicalDto,
    user: AuthContext,
  ): Promise<SurgicalProfileDto> {
    await this.access.assertVisitInOrg(visitId, user);

    const visit = await this.prismaService.db.visit.findFirst({
      where: { id: visitId, is_deleted: false },
      select: {
        specialty_code: true,
        scheduled_at: true,
        episode: {
          select: {
            id: true,
            journey: {
              select: {
                id: true,
                patient_id: true,
                organization_id: true,
                status: true,
                care_path: { select: { code: true } },
              },
            },
          },
        },
      },
    });
    const journey = visit?.episode?.journey;
    if (!journey) {
      throw new NotFoundException(`Visit ${visitId} has no journey`);
    }
    if (journey.status !== 'ACTIVE') {
      throw new ConflictException(
        'The visit journey is not active; cannot start a surgical profile',
      );
    }

    // Idempotent: a surgical profile is already open on this journey → return it.
    const existing =
      await this.prismaService.db.surgicalJourneyRecord.findFirst({
        where: { journey_id: journey.id, is_deleted: false },
        select: { journey_id: true, status: true, created_at: true },
      });
    if (existing) {
      return {
        journey_id: existing.journey_id,
        status: existing.status ?? 'ACTIVE',
        created_at: existing.created_at.toISOString(),
      };
    }

    const carePath = await this.prismaService.db.carePath.findFirst({
      where: {
        code: SURGICAL_CARE_PATH_CODE,
        is_deleted: false,
        ...(visit.specialty_code
          ? { specialty: { code: visit.specialty_code, is_deleted: false } }
          : {}),
        OR: [
          { organization_id: null },
          { organization_id: user.organizationId },
        ],
      },
      orderBy: [{ organization_id: { sort: 'desc', nulls: 'last' } }],
      select: { id: true, journey_template_id: true },
    });
    if (!carePath) {
      throw new NotFoundException(
        `Care path "${SURGICAL_CARE_PATH_CODE}" is not configured for this specialty`,
      );
    }

    // Cesarean handoff gate: an ACTIVE pregnancy on this journey must be closed
    // first. Without the confirmation outcome, signal the FE to show the warning
    // drawer; with it, the pregnancy is closed inside the activation transaction.
    const activePregnancy =
      await this.prismaService.db.pregnancyJourneyRecord.findFirst({
        where: { journey_id: journey.id, status: 'ACTIVE', is_deleted: false },
      });
    if (activePregnancy && !dto.pregnancy_outcome) {
      throw new ConflictException({
        code: ERROR_CODES.PREGNANCY_ACTIVE_REQUIRES_CLOSE,
        message:
          'This patient has an active pregnancy journey. Close it (record the outcome) before opening a surgical journey.',
        details: {
          journey_id: journey.id,
          requires: 'pregnancy_outcome',
        },
      });
    }

    const previousCarePathCode = journey.care_path?.code ?? null;
    const oldJourneyId = journey.id;
    const patientId = journey.patient_id;
    const sourcePregnancyJourneyId = activePregnancy ? oldJourneyId : null;

    // A surgical journey is its OWN journey: optionally close the active pregnancy
    // (cesarean handoff), complete the current journey, open a fresh surgical
    // journey + episodes, re-point the current visit onto the phase episode, and
    // attach the surgical record. Old-before-new ordering avoids the "one ACTIVE
    // journey per (patient, template)" index conflict.
    const record = await this.prismaService.db.$transaction(async (tx) => {
      const journeyTemplate = await tx.journeyTemplate.findUniqueOrThrow({
        where: { id: carePath.journey_template_id },
        select: {
          id: true,
          episodes: {
            where: { is_deleted: false },
            orderBy: { order: 'asc' },
            select: { id: true, name: true, order: true },
          },
        },
      });

      // Close the active pregnancy first (cesarean outcome → delivery_plan).
      if (activePregnancy && dto.pregnancy_outcome) {
        await tx.pregnancyJourneyRecordRevision.create({
          data: buildRevision(
            activePregnancy,
            ['status', 'delivery_plan'],
            user.profileId,
          ),
        });
        await tx.pregnancyJourneyRecord.update({
          where: { id: activePregnancy.id },
          data: {
            status: 'CLOSED',
            delivery_plan: {
              ...dto.pregnancy_outcome,
            } as Prisma.InputJsonValue,
            updated_by_id: user.profileId,
            version: { increment: 1 },
          },
        });
      }

      // Archive the journey the visit came from BEFORE creating the new one.
      await tx.patientJourney.update({
        where: { id: oldJourneyId },
        data: { status: 'COMPLETED', ended_at: new Date() },
      });

      const newJourney = await tx.patientJourney.create({
        data: {
          patient_id: patientId,
          organization_id: journey.organization_id,
          journey_template_id: journeyTemplate.id,
          care_path_id: carePath.id,
          created_by_id: user.profileId,
          status: 'ACTIVE',
        },
      });

      await tx.patientEpisode.createMany({
        data: journeyTemplate.episodes.map((ep, i) => ({
          journey_id: newJourney.id,
          episode_template_id: ep.id,
          name: ep.name,
          order: ep.order,
          status: i === 0 ? ('ACTIVE' as const) : ('PENDING' as const),
          started_at: i === 0 ? new Date() : null,
        })),
      });

      // Re-point the current visit onto the phase episode matching its date vs
      // the surgery date (defaults to the first/Pre-op episode without a date).
      const order =
        this.episodeRouter.resolveEpisodeOrder(
          dto.surgery_date ? new Date(dto.surgery_date) : null,
          visit.scheduled_at ?? new Date(),
        ) ?? 1;
      await this.episodeRouter.routeVisitToEpisode(
        tx,
        newJourney.id,
        visitId,
        order,
      );

      return tx.surgicalJourneyRecord.create({
        data: {
          journey_id: newJourney.id,
          status: 'ACTIVE',
          procedure_id: dto.procedure_id ?? null,
          procedure_code: dto.procedure_code ?? null,
          procedure_name: dto.procedure_name ?? null,
          indication: dto.indication ?? null,
          planned_date: dto.planned_date ? new Date(dto.planned_date) : null,
          surgery_date: dto.surgery_date ? new Date(dto.surgery_date) : null,
          urgency: dto.urgency ?? null,
          anesthesia_type: dto.anesthesia_type ?? null,
          source_pregnancy_journey_id: sourcePregnancyJourneyId,
          updated_by_id: user.profileId,
        },
        select: {
          journey_id: true,
          status: true,
          created_at: true,
          procedure_code: true,
          procedure_name: true,
        },
      });
    });

    if (activePregnancy && dto.pregnancy_outcome) {
      this.eventBus.publish<PregnancyClosedEvent>(
        CLINICAL_EVENTS.pregnancy.closed,
        {
          journey_id: oldJourneyId,
          patient_id: patientId,
          outcome_type: dto.pregnancy_outcome.outcome_type,
          outcome: { ...dto.pregnancy_outcome },
          closed_by_id: user.profileId,
        },
      );
    }
    this.eventBus.publish(CLINICAL_EVENTS.journey.completed, {
      journey_id: oldJourneyId,
      patient_id: patientId,
    });
    this.eventBus.publish(CLINICAL_EVENTS.journey.started, {
      journey_id: record.journey_id,
      patient_id: patientId,
    });
    this.eventBus.publish<JourneyCarePathSetEvent>(
      CLINICAL_EVENTS.journey.carePathSet,
      {
        journey_id: record.journey_id,
        visit_id: visitId,
        patient_id: patientId,
        previous_care_path_code: previousCarePathCode,
        new_care_path_code: SURGICAL_CARE_PATH_CODE,
        updated_by_id: user.profileId,
      },
    );
    this.eventBus.publish<SurgicalBookedEvent>(
      CLINICAL_EVENTS.surgical.booked,
      {
        journey_id: record.journey_id,
        patient_id: patientId,
        procedure_code: record.procedure_code,
        procedure_name: record.procedure_name,
        source_pregnancy_journey_id: sourcePregnancyJourneyId,
      },
    );

    return {
      journey_id: record.journey_id,
      status: record.status ?? 'ACTIVE',
      created_at: record.created_at.toISOString(),
    };
  }

  async close(
    visitId: string,
    dto: CloseSurgicalDto,
    user: AuthContext,
  ): Promise<SurgicalProfileDto> {
    await this.access.assertVisitInOrg(visitId, user);

    const visit = await this.prismaService.db.visit.findFirst({
      where: { id: visitId, is_deleted: false },
      select: {
        assigned_doctor_id: true,
        episode: {
          select: { journey: { select: { id: true, patient_id: true } } },
        },
      },
    });
    const journey = visit?.episode?.journey;
    if (!journey) {
      throw new NotFoundException(`Visit ${visitId} has no journey`);
    }

    // Authority: the visit's assigned doctor or an org OWNER may close.
    const isAssigned = visit.assigned_doctor_id === user.profileId;
    const isOwner = user.role === 'OWNER';
    if (!isAssigned && !isOwner) {
      throw new ForbiddenException(
        'Only the assigned doctor or an organization owner may close a surgical journey',
      );
    }

    const record = await this.prismaService.db.surgicalJourneyRecord.findFirst({
      where: { journey_id: journey.id, status: 'ACTIVE', is_deleted: false },
    });
    if (!record) {
      throw new ConflictException(
        'No active surgical journey to close on this visit',
      );
    }

    const outcome = { ...dto.outcome } as Prisma.InputJsonValue;

    const updated = await this.prismaService.db.$transaction(async (tx) => {
      await tx.surgicalJourneyRecordRevision.create({
        data: buildRevision(record, ['status', 'outcome'], user.profileId),
      });
      const next = await tx.surgicalJourneyRecord.update({
        where: { id: record.id },
        data: {
          status: 'CLOSED',
          outcome,
          updated_by_id: user.profileId,
          version: { increment: 1 },
        },
        select: { journey_id: true, status: true, created_at: true },
      });
      await tx.patientJourney.update({
        where: { id: journey.id },
        data: { status: 'COMPLETED', ended_at: new Date() },
      });
      return next;
    });

    this.eventBus.publish<SurgicalClosedEvent>(
      CLINICAL_EVENTS.surgical.closed,
      {
        journey_id: journey.id,
        patient_id: journey.patient_id,
        outcome_type: dto.outcome.outcome_type,
        outcome: { ...dto.outcome },
        closed_by_id: user.profileId,
      },
    );

    return {
      journey_id: updated.journey_id,
      status: updated.status ?? 'CLOSED',
      created_at: updated.created_at.toISOString(),
    };
  }
}
