import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { assertVersionMatches } from '@common/decorators/if-match.decorator';
import { ERROR_CODES } from '@common/constant/error-codes';
import { ObgynPatientAccessService } from '../patient-access.service';

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

    return this.prismaService.db.pregnancyJourneyRecord.create({
      data: { journey_id: journeyId, updated_by_id: user.profileId },
    });
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

    return this.prismaService.db.pregnancyJourneyRecord.update({
      where: { id: current.id },
      data: {
        ...this.toJourneyData(patch),
        version: { increment: 1 },
        updated_by_id: user.profileId,
      },
    });
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

    const data: Prisma.PregnancyEpisodeRecordUncheckedUpdateInput = {
      version: { increment: 1 },
      updated_by_id: user.profileId,
    };
    if (patch.anomaly_scan !== undefined)
      data.anomaly_scan = patch.anomaly_scan as Prisma.InputJsonValue;
    if (patch.gtt_result !== undefined)
      data.gtt_result = patch.gtt_result as Prisma.InputJsonValue;
    if (patch.trimester_summary !== undefined) {
      data.trimester_summary = patch.trimester_summary as Prisma.InputJsonValue;
    }

    return this.prismaService.db.pregnancyEpisodeRecord.update({
      where: { id: current.id },
      data,
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

  async patchVisitRecord(
    visitId: string,
    section: VisitRecordSection,
    patch: Record<string, unknown>,
    ifMatchVersion: number,
    user: AuthContext,
  ) {
    await this.assertVisitOnPregnancyJourney(visitId, user);
    const current = await this.getVisitRecord(visitId, user);
    assertVersionMatches(ifMatchVersion, current.version);

    const data = this.toVisitData(section, patch);
    return this.prismaService.db.visitPregnancyRecord.update({
      where: { id: current.id },
      data: {
        ...data,
        version: { increment: 1 },
        updated_by_id: user.profileId,
      },
    });
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
    section: VisitRecordSection,
    patch: Record<string, unknown>,
  ): Prisma.VisitPregnancyRecordUncheckedUpdateInput {
    const allowedBySection: Record<VisitRecordSection, readonly string[]> = {
      cervix: [
        'cervix_length_mm',
        'cervix_dilatation_cm',
        'cervix_effacement_pct',
        'cervix_position',
        'membranes',
      ],
      'warning-symptoms': ['warning_symptoms'],
      fundal: ['fundal_height_cm', 'fundal_corresponds_ga'],
      'amniotic-placenta': [
        'amniotic_fluid',
        'placenta_location',
        'placenta_grade',
      ],
      'fetal-lie': ['fetal_lie', 'presentation', 'engagement'],
      biometrics: [
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
      ],
    };

    if (section === 'warning-symptoms') {
      // The warning-symptoms block is stored as a single JSON column.
      return { warning_symptoms: patch as Prisma.InputJsonValue };
    }

    const out: Record<string, unknown> = {};
    for (const key of allowedBySection[section]) {
      if (key in patch) out[key] = patch[key];
    }
    return out as Prisma.VisitPregnancyRecordUncheckedUpdateInput;
  }
}

export type VisitRecordSection =
  | 'cervix'
  | 'warning-symptoms'
  | 'fundal'
  | 'amniotic-placenta'
  | 'fetal-lie'
  | 'biometrics';
