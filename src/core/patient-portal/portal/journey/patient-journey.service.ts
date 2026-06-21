import { Injectable } from '@nestjs/common';
import { EpisodeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { resolveAccessiblePatientIds } from '../accessible-patients.util.js';
import { GetPatientJourneyQueryDto } from './dto/get-patient-journey.query.dto.js';
import {
  PatientJourneyDto,
  PatientJourneyStageStatus,
} from './dto/patient-journey.dto.js';
import { computePregnancyDating } from './pregnancy-dating.util.js';

/** Prisma `include` for the patient's active journey + its stages and pregnancy. */
const journeyInclude = {
  care_path: {
    select: { code: true, name: true, specialty: { select: { code: true } } },
  },
  episodes: {
    where: { is_deleted: false },
    orderBy: { order: 'asc' },
    select: { id: true, name: true, order: true, status: true },
  },
  pregnancy_record: true,
} satisfies Prisma.PatientJourneyInclude;

type JourneyRow = Prisma.PatientJourneyGetPayload<{
  include: typeof journeyInclude;
}>;

/** Maps an episode's lifecycle status to the portal stepper's tri-state. */
function stageStatus(status: EpisodeStatus): PatientJourneyStageStatus {
  switch (status) {
    case EpisodeStatus.COMPLETED:
      return 'DONE';
    case EpisodeStatus.ACTIVE:
      return 'CURRENT';
    default:
      return 'UPCOMING';
  }
}

@Injectable()
export class PatientJourneyService {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Returns the caller's single active journey (newest started) shaped for the
   * portal home dashboard: care-path type, ordered stages with a derived
   * DONE/CURRENT/UPCOMING status, and an optional pregnancy block (GA + EDD
   * computed server-side). Returns null when the patient has no active journey.
   * Scoped to the patients the caller may access.
   */
  async getActiveJourney(
    ctx: PatientAuthContext,
    query: GetPatientJourneyQueryDto,
  ): Promise<PatientJourneyDto | null> {
    const targetIds = resolveAccessiblePatientIds(ctx, query.patient_id);
    if (targetIds.length === 0) return null;

    const journey = await this.prismaService.db.patientJourney.findFirst({
      where: {
        is_deleted: false,
        status: 'ACTIVE',
        patient_id: { in: targetIds },
      },
      orderBy: { started_at: 'desc' },
      include: journeyInclude,
    });

    if (!journey) return null;
    return this.toDto(journey, new Date());
  }

  private toDto(journey: JourneyRow, now: Date): PatientJourneyDto {
    const record = journey.pregnancy_record;
    const pregnancy = record
      ? (() => {
          const dating = computePregnancyDating(
            {
              lmp: record.lmp,
              us_dating_date: record.us_dating_date,
              us_ga_weeks: record.us_ga_weeks,
              us_ga_days: record.us_ga_days,
            },
            now,
          );
          return {
            gestational_age_weeks: dating.gestationalAgeWeeks,
            gestational_age_days: dating.gestationalAgeDays,
            estimated_due_date: dating.estimatedDueDate,
            number_of_fetuses: record.number_of_fetuses ?? null,
            pregnancy_type: record.pregnancy_type ?? null,
            fetal_sexes: record.gender ?? null,
            risk_level: record.risk_level ?? null,
          };
        })()
      : null;

    return {
      journey_id: journey.id,
      care_path_code: journey.care_path?.code ?? null,
      specialty_code: journey.care_path?.specialty?.code ?? null,
      label: journey.care_path?.name ?? null,
      status: journey.status,
      started_at: journey.started_at,
      stages: journey.episodes.map((e) => ({
        id: e.id,
        name: e.name,
        order: e.order,
        status: stageStatus(e.status),
      })),
      pregnancy,
    };
  }
}
