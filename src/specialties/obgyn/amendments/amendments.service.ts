import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { ERROR_CODES } from '@common/constant/error-codes';
import { assertVersionMatches } from '@common/decorators/if-match.decorator';
import {
  AmendmentResultDto,
  AmendmentTarget,
  CreateAmendmentDto,
} from './dto/amendment.dto';

const VISIT_SCOPED: ReadonlySet<AmendmentTarget> = new Set([
  'obgyn_encounter',
  'pregnancy_record',
]);

const OBGYN_ENCOUNTER_SECTIONS: ReadonlySet<string> = new Set([
  'general_findings',
  'cardiovascular_findings',
  'respiratory_findings',
  'menstrual_findings',
  'abdominal_findings',
  'pelvic_findings',
  'breast_findings',
  'extremities_findings',
  'neurological_findings',
  'skin_findings',
]);

const PREGNANCY_VISIT_SECTIONS = [
  'cervix',
  'warning-symptoms',
  'fundal',
  'amniotic-placenta',
  'fetal-lie',
  'biometrics',
] as const;

type PregnancyVisitSection = (typeof PREGNANCY_VISIT_SECTIONS)[number];

const PREGNANCY_VISIT_SECTION_SET: ReadonlySet<string> = new Set(
  PREGNANCY_VISIT_SECTIONS,
);

const PREGNANCY_VISIT_COLUMNS: Record<
  PregnancyVisitSection,
  readonly string[]
> = {
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

/**
 * Amendment service — the structurally distinct path for editing a closed
 * encounter. Unlike the normal PATCH endpoints (guarded by
 * EncounterMutationGuard), amendments REQUIRE the visit to be COMPLETED,
 * REQUIRE a `reason`, and (PR4) will append a revision shadow row capturing
 * the prior snapshot.
 *
 * In PR3 the revision-shadow write is stubbed — the service applies the
 * change and bumps `version`, but the prior snapshot is not yet persisted
 * to a `*_revisions` table. The amendment metadata (reason, who, when,
 * version delta) is returned in the response and emitted via Pino logs so
 * it's auditable in log aggregation even before PR4 lands.
 */
@Injectable()
export class AmendmentsService {
  constructor(private readonly prismaService: PrismaService) {}

  async createForVisit(
    visitId: string,
    dto: CreateAmendmentDto,
    user: AuthContext,
    ifMatchVersion: number,
  ): Promise<AmendmentResultDto> {
    const visit = await this.loadAndAuthorizeVisit(visitId, user);

    if (!VISIT_SCOPED.has(dto.target)) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_ERROR,
        message:
          'This amendment target is not visit-scoped. Use the patient- or journey-scoped amendment endpoint.',
        details: { target: dto.target, visit_id: visitId },
      });
    }

    if (dto.target === 'obgyn_encounter') {
      return this.amendObgynEncounter(
        visitId,
        dto,
        user,
        ifMatchVersion,
        visit.patient_id,
      );
    }
    return this.amendVisitPregnancyRecord(
      visitId,
      dto,
      user,
      ifMatchVersion,
      visit.patient_id,
    );
  }

  // ---------- internal: visit + authority ----------

  private async loadAndAuthorizeVisit(visitId: string, user: AuthContext) {
    const visit = await this.prismaService.db.visit.findFirst({
      where: { id: visitId, is_deleted: false },
      select: {
        id: true,
        status: true,
        assigned_doctor_id: true,
        episode: {
          select: {
            journey: {
              select: { organization_id: true, patient_id: true },
            },
          },
        },
      },
    });
    if (
      !visit ||
      visit.episode.journey.organization_id !== user.organizationId
    ) {
      throw new NotFoundException(`Visit ${visitId} not found`);
    }
    if (visit.status !== 'COMPLETED' && visit.status !== 'CANCELLED') {
      throw new ConflictException({
        code: ERROR_CODES.CONFLICT,
        message:
          'Amendments only apply to closed visits. Use the PATCH endpoints while the visit is open.',
        details: { visit_id: visitId, status: visit.status },
      });
    }
    // Authority: assigned doctor or org OWNER may amend.
    const isAssigned = visit.assigned_doctor_id === user.profileId;
    const isOwner = user.roles.includes('OWNER');
    if (!isAssigned && !isOwner) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message:
          'Only the assigned doctor or an organization owner may amend a closed visit',
        details: { visit_id: visitId },
      });
    }
    return { id: visit.id, patient_id: visit.episode.journey.patient_id };
  }

  // ---------- target dispatchers ----------

  private async amendObgynEncounter(
    visitId: string,
    dto: CreateAmendmentDto,
    user: AuthContext,
    ifMatchVersion: number,
    patientId: string,
  ): Promise<AmendmentResultDto> {
    const section = dto.section;
    if (!section || !OBGYN_ENCOUNTER_SECTIONS.has(section)) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Unknown obgyn_encounter section for amendment',
        details: {
          section: section ?? null,
          allowed: Array.from(OBGYN_ENCOUNTER_SECTIONS),
        },
      });
    }

    const current = await this.prismaService.db.visitObgynEncounter.findUnique({
      where: { visit_id: visitId },
    });
    if (!current) {
      throw new NotFoundException(
        `No OB/GYN encounter recorded for visit ${visitId}; nothing to amend`,
      );
    }
    assertVersionMatches(ifMatchVersion, current.version);

    const updated = await this.prismaService.db.visitObgynEncounter.update({
      where: { id: current.id },
      data: {
        [section]: dto.changes as Prisma.InputJsonValue,
        version: { increment: 1 },
        updated_by_id: user.profileId,
      } as unknown as Prisma.VisitObgynEncounterUncheckedUpdateInput,
    });

    return this.toResult('obgyn_encounter', section, {
      visit_id: visitId,
      patient_id: patientId,
      from: current.version,
      to: updated.version,
      reason: dto.reason,
      user,
    });
  }

  private async amendVisitPregnancyRecord(
    visitId: string,
    dto: CreateAmendmentDto,
    user: AuthContext,
    ifMatchVersion: number,
    patientId: string,
  ): Promise<AmendmentResultDto> {
    const section = dto.section;
    if (!section || !PREGNANCY_VISIT_SECTION_SET.has(section)) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Unknown pregnancy_record section for amendment',
        details: {
          section: section ?? null,
          allowed: PREGNANCY_VISIT_SECTIONS,
        },
      });
    }

    const current = await this.prismaService.db.visitPregnancyRecord.findUnique(
      {
        where: { visit_id: visitId },
      },
    );
    if (!current) {
      throw new NotFoundException(
        `No pregnancy record on visit ${visitId}; nothing to amend`,
      );
    }
    assertVersionMatches(ifMatchVersion, current.version);

    const data: Prisma.VisitPregnancyRecordUncheckedUpdateInput = {
      version: { increment: 1 },
      updated_by_id: user.profileId,
    };
    if (section === 'warning-symptoms') {
      data.warning_symptoms = dto.changes as Prisma.InputJsonValue;
    } else {
      const allowed = PREGNANCY_VISIT_COLUMNS[section as PregnancyVisitSection];
      for (const key of allowed) {
        if (key in dto.changes) {
          (data as Record<string, unknown>)[key] = dto.changes[key];
        }
      }
    }

    const updated = await this.prismaService.db.visitPregnancyRecord.update({
      where: { id: current.id },
      data,
    });

    return this.toResult('pregnancy_record', section, {
      visit_id: visitId,
      patient_id: patientId,
      from: current.version,
      to: updated.version,
      reason: dto.reason,
      user,
    });
  }

  private toResult(
    target: AmendmentTarget,
    section: string,
    args: {
      visit_id: string;
      patient_id: string;
      from: number;
      to: number;
      reason: string;
      user: AuthContext;
    },
  ): AmendmentResultDto {
    return {
      target,
      section,
      visit_id: args.visit_id,
      journey_id: null,
      episode_id: null,
      patient_id: args.patient_id,
      version_from: args.from,
      version_to: args.to,
      amended_by_id: args.user.profileId,
      reason: args.reason,
      amended_at: new Date(),
    };
  }
}
