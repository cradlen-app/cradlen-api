import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { EventBus } from '@infrastructure/messaging/event-bus';
import {
  CLINICAL_EVENTS,
  JourneyCarePathSetEvent,
  PregnancyBookedEvent,
  PregnancyClosedEvent,
} from '@core/clinical/events/clinical-events';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.public';
import { buildRevision } from '../revisions.helper';
import { PREGNANCY_CARE_PATH_CODE } from './pregnancy-care-path.guard';
import {
  ClosePregnancyDto,
  CreatePregnancyDto,
  PregnancyProfileDto,
} from './dto/pregnancy-activation.dto';

/**
 * Lifecycle of a pregnancy profile: activation (the drawer's "Create") and
 * closing (delivery). Activation reclassifies the patient's single ACTIVE
 * journey in place — it never opens or closes a journey — and attaches an
 * ACTIVE pregnancy profile, which makes the descriptor declare the clinical
 * surface so the Pregnancy tab appears. Closing records the delivery outcome
 * and completes the journey, freeing the single-active slot.
 */
@Injectable()
export class PregnancyActivationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly access: PatientAccessService,
    private readonly eventBus: EventBus,
  ) {}

  async activate(
    visitId: string,
    dto: CreatePregnancyDto,
    user: AuthContext,
  ): Promise<PregnancyProfileDto> {
    await this.access.assertVisitInOrg(visitId, user);

    const visit = await this.prismaService.db.visit.findFirst({
      where: { id: visitId, is_deleted: false },
      select: {
        specialty_code: true,
        episode: {
          select: {
            journey: {
              select: {
                id: true,
                patient_id: true,
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
        'The visit journey is not active; cannot start a pregnancy profile',
      );
    }

    // Idempotent: a pregnancy is already open on this journey → return it.
    const existing =
      await this.prismaService.db.pregnancyJourneyRecord.findFirst({
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
        code: PREGNANCY_CARE_PATH_CODE,
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
      select: { id: true },
    });
    if (!carePath) {
      throw new NotFoundException(
        `Care path "${PREGNANCY_CARE_PATH_CODE}" is not configured for this specialty`,
      );
    }

    const previousCarePathCode = journey.care_path?.code ?? null;

    const record = await this.prismaService.db.$transaction(async (tx) => {
      await tx.patientJourney.update({
        where: { id: journey.id },
        data: { care_path_id: carePath.id },
      });
      return tx.pregnancyJourneyRecord.create({
        data: {
          journey_id: journey.id,
          status: 'ACTIVE',
          risk_level: dto.risk_level ?? null,
          lmp: dto.lmp ? new Date(dto.lmp) : null,
          us_dating_date: dto.us_dating_date
            ? new Date(dto.us_dating_date)
            : null,
          us_ga_weeks: dto.us_ga_weeks ?? null,
          us_ga_days: dto.us_ga_days ?? null,
          pregnancy_type: dto.pregnancy_type ?? null,
          number_of_fetuses: dto.number_of_fetuses ?? null,
          updated_by_id: user.profileId,
        },
        select: { journey_id: true, status: true, created_at: true, lmp: true },
      });
    });

    if (previousCarePathCode !== PREGNANCY_CARE_PATH_CODE) {
      this.eventBus.publish<JourneyCarePathSetEvent>(
        CLINICAL_EVENTS.journey.carePathSet,
        {
          journey_id: journey.id,
          visit_id: visitId,
          patient_id: journey.patient_id,
          previous_care_path_code: previousCarePathCode,
          new_care_path_code: PREGNANCY_CARE_PATH_CODE,
          updated_by_id: user.profileId,
        },
      );
    }
    this.eventBus.publish<PregnancyBookedEvent>(
      CLINICAL_EVENTS.pregnancy.booked,
      {
        journey_id: journey.id,
        patient_id: journey.patient_id,
        lmp: record.lmp,
        risk_level: dto.risk_level ?? null,
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
    dto: ClosePregnancyDto,
    user: AuthContext,
  ): Promise<PregnancyProfileDto> {
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
        'Only the assigned doctor or an organization owner may close a pregnancy',
      );
    }

    const record = await this.prismaService.db.pregnancyJourneyRecord.findFirst(
      {
        where: { journey_id: journey.id, status: 'ACTIVE', is_deleted: false },
      },
    );
    if (!record) {
      throw new ConflictException(
        'No active pregnancy to close on this journey',
      );
    }

    // The outcome (delivery or otherwise) is stored in the existing
    // `delivery_plan` Json column — the journey completes for ANY outcome type.
    const outcome = { ...dto.outcome } as Prisma.InputJsonValue;

    const updated = await this.prismaService.db.$transaction(async (tx) => {
      await tx.pregnancyJourneyRecordRevision.create({
        data: buildRevision(
          record,
          ['status', 'delivery_plan'],
          user.profileId,
        ),
      });
      const next = await tx.pregnancyJourneyRecord.update({
        where: { id: record.id },
        data: {
          status: 'CLOSED',
          delivery_plan: outcome,
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

    this.eventBus.publish<PregnancyClosedEvent>(
      CLINICAL_EVENTS.pregnancy.closed,
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
