import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { assertVersionMatches } from '@common/decorators/if-match.decorator';
import { ERROR_CODES } from '@common/constant/error-codes';
import { EventBus } from '@infrastructure/messaging/event-bus';
import {
  CLINICAL_EVENTS,
  type PregnancyBookedEvent,
  type PregnancyRiskLevelChangedEvent,
} from '@core/clinical/events/events.public';
import { ObgynPatientAccessService } from '../patient-access.service';
import { buildRevision } from '../revisions.helper';

const PREGNANCY_CARE_PATH_CODE = 'OBGYN_PREGNANCY';

function assertPregnancyCarePath(carePathCode: string | undefined | null) {
  if (carePathCode !== PREGNANCY_CARE_PATH_CODE) {
    throw new ConflictException({
      code: ERROR_CODES.CONFLICT,
      message:
        'Pregnancy records are only valid on journeys whose care path is OBGYN_PREGNANCY',
      details: {
        expected_care_path: PREGNANCY_CARE_PATH_CODE,
        actual: carePathCode ?? null,
      },
    });
  }
}

@Injectable()
export class PregnancyService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly access: ObgynPatientAccessService,
    private readonly eventBus: EventBus,
  ) {}

  // ---------- Journey-level snapshot ----------

  async getJourneyRecord(journeyId: string, user: AuthContext) {
    const journey = await this.access.assertJourneyInOrg(journeyId, user);
    assertPregnancyCarePath(journey.care_path?.code);

    const existing =
      await this.prismaService.db.pregnancyJourneyRecord.findUnique({
        where: { journey_id: journeyId },
      });
    if (existing) return existing;

    const created = await this.prismaService.db.pregnancyJourneyRecord.create({
      data: { journey_id: journeyId, updated_by_id: user.profileId },
    });
    // First-time creation = the pregnancy is booked into the system.
    const patient = await this.prismaService.db.patientJourney.findUnique({
      where: { id: journeyId },
      select: { patient_id: true },
    });
    if (patient) {
      this.eventBus.publish<PregnancyBookedEvent>(
        CLINICAL_EVENTS.pregnancy.booked,
        {
          journey_id: journeyId,
          patient_id: patient.patient_id,
          lmp: created.lmp,
          risk_level: created.risk_level,
        },
      );
    }
    return created;
  }

  async patchJourneyRecord(
    journeyId: string,
    patch: Record<string, unknown>,
    ifMatchVersion: number,
    user: AuthContext,
  ) {
    const journey = await this.access.assertJourneyInOrg(journeyId, user);
    assertPregnancyCarePath(journey.care_path?.code);

    const current = await this.getJourneyRecord(journeyId, user);
    assertVersionMatches(ifMatchVersion, current.version);

    const data = this.toJourneyData(patch);
    const changedFields = Object.keys(data);

    const updated = await this.prismaService.db.$transaction(async (tx) => {
      await tx.pregnancyJourneyRecordRevision.create({
        data: buildRevision(current, changedFields, user.profileId),
      });
      return tx.pregnancyJourneyRecord.update({
        where: { id: current.id },
        data: {
          ...data,
          version: { increment: 1 },
          updated_by_id: user.profileId,
        },
      });
    });

    if ('risk_level' in patch && patch['risk_level'] !== current.risk_level) {
      this.eventBus.publish<PregnancyRiskLevelChangedEvent>(
        CLINICAL_EVENTS.pregnancy.riskLevelChanged,
        {
          journey_id: journeyId,
          previous_risk_level: current.risk_level,
          new_risk_level: updated.risk_level,
          updated_by_id: user.profileId,
        },
      );
    }

    return updated;
  }

  private toJourneyData(
    patch: Record<string, unknown>,
  ): Prisma.PregnancyJourneyRecordUncheckedUpdateInput {
    // Permit only known columns; ignore unknown keys silently (the DTO already
    // validates shape — this is a defensive whitelist before hitting Prisma).
    const allowed = [
      'status',
      'risk_level',
      'lmp',
      'blood_group_rh',
      'us_dating_date',
      'us_ga_weeks',
      'us_ga_days',
      'pregnancy_type',
      'number_of_fetuses',
      'gender',
      'delivery_plan',
    ] as const;
    const out: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in patch) {
        out[key] = patch[key];
      }
    }
    return out as Prisma.PregnancyJourneyRecordUncheckedUpdateInput;
  }

  // ---------- Episode-level trimester milestones ----------

  async getEpisodeRecord(episodeId: string, user: AuthContext) {
    const episode = await this.access.assertEpisodeInOrg(episodeId, user);
    assertPregnancyCarePath(episode.journey.care_path?.code);

    const existing =
      await this.prismaService.db.pregnancyEpisodeRecord.findUnique({
        where: { episode_id: episodeId },
      });
    if (existing) return existing;

    return this.prismaService.db.pregnancyEpisodeRecord.create({
      data: { episode_id: episodeId, updated_by_id: user.profileId },
    });
  }

  async patchEpisodeRecord(
    episodeId: string,
    patch: {
      anomaly_scan?: object;
      gtt_result?: object;
      trimester_summary?: object;
    },
    ifMatchVersion: number,
    user: AuthContext,
  ) {
    const episode = await this.access.assertEpisodeInOrg(episodeId, user);
    assertPregnancyCarePath(episode.journey.care_path?.code);

    const current = await this.getEpisodeRecord(episodeId, user);
    assertVersionMatches(ifMatchVersion, current.version);

    const changed: string[] = [];
    const data: Prisma.PregnancyEpisodeRecordUncheckedUpdateInput = {
      version: { increment: 1 },
      updated_by_id: user.profileId,
    };
    if (patch.anomaly_scan !== undefined) {
      data.anomaly_scan = patch.anomaly_scan as Prisma.InputJsonValue;
      changed.push('anomaly_scan');
    }
    if (patch.gtt_result !== undefined) {
      data.gtt_result = patch.gtt_result as Prisma.InputJsonValue;
      changed.push('gtt_result');
    }
    if (patch.trimester_summary !== undefined) {
      data.trimester_summary = patch.trimester_summary as Prisma.InputJsonValue;
      changed.push('trimester_summary');
    }

    return this.prismaService.db.$transaction(async (tx) => {
      await tx.pregnancyEpisodeRecordRevision.create({
        data: buildRevision(current, changed, user.profileId),
      });
      return tx.pregnancyEpisodeRecord.update({
        where: { id: current.id },
        data,
      });
    });
  }

  // ---------- Visit-level per-ANC measurements ----------

  async getVisitRecord(visitId: string, user: AuthContext) {
    await this.assertVisitOnPregnancyJourney(visitId, user);

    const existing =
      await this.prismaService.db.visitPregnancyRecord.findUnique({
        where: { visit_id: visitId },
      });
    if (existing) return existing;

    return this.prismaService.db.visitPregnancyRecord.create({
      data: { visit_id: visitId, updated_by_id: user.profileId },
    });
  }

  /**
   * Bulk PATCH — save the whole pregnancy visit tab in one request. Any
   * subset of fields (cervix, warning symptoms, fundal, amniotic/placenta,
   * fetal lie, biometrics) may be present.
   */
  async patchVisitRecord(
    visitId: string,
    patch: Record<string, unknown>,
    ifMatchVersion: number,
    user: AuthContext,
  ) {
    await this.assertVisitOnPregnancyJourney(visitId, user);
    const current = await this.getVisitRecord(visitId, user);
    assertVersionMatches(ifMatchVersion, current.version);

    const data = this.toVisitData(patch);
    const changedFields = Object.keys(data);
    if (changedFields.length === 0) return current;

    return this.prismaService.db.$transaction(async (tx) => {
      await tx.visitPregnancyRecordRevision.create({
        data: buildRevision(current, changedFields, user.profileId),
      });
      return tx.visitPregnancyRecord.update({
        where: { id: current.id },
        data: {
          ...data,
          version: { increment: 1 },
          updated_by_id: user.profileId,
        },
      });
    });
    // No per-section event — high frequency, low downstream value. The
    // revision row is sufficient audit.
  }

  private async assertVisitOnPregnancyJourney(
    visitId: string,
    user: AuthContext,
  ) {
    await this.access.assertVisitInOrg(visitId, user);
    const visit = await this.prismaService.db.visit.findFirst({
      where: { id: visitId, is_deleted: false },
      select: {
        episode: {
          select: {
            journey: { select: { care_path: { select: { code: true } } } },
          },
        },
      },
    });
    assertPregnancyCarePath(visit?.episode.journey.care_path?.code);
  }

  private toVisitData(
    patch: Record<string, unknown>,
  ): Prisma.VisitPregnancyRecordUncheckedUpdateInput {
    // Whitelist of writable columns on VisitPregnancyRecord. Anything outside
    // this set is ignored (defensive — the DTO already validates shape).
    const allowed = [
      'cervix_length_mm',
      'cervix_dilatation_cm',
      'cervix_effacement_pct',
      'cervix_position',
      'membranes',
      'warning_symptoms',
      'fundal_height_cm',
      'fundal_corresponds_ga',
      'amniotic_fluid',
      'placenta_location',
      'placenta_grade',
      'fetal_lie',
      'presentation',
      'engagement',
      'fetal_heart_rate_bpm',
      'fetal_rhythm',
      'fetal_movements',
      'bpd_mm',
      'hc_mm',
      'ac_mm',
      'fl_mm',
      'efw_g',
      'growth_percentile',
      'growth_impression',
    ] as const;

    const out: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in patch) {
        out[key] =
          key === 'warning_symptoms'
            ? (patch[key] as Prisma.InputJsonValue)
            : patch[key];
      }
    }
    return out as Prisma.VisitPregnancyRecordUncheckedUpdateInput;
  }
}
