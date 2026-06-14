import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { StorageService } from '@infrastructure/storage/storage.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.public.js';
import { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { CreatePatientDto } from './dto/create-patient.dto.js';
import { UpdatePatientDto } from './dto/update-patient.dto.js';
import { ListPatientsQueryDto } from './dto/list-patients-query.dto.js';
import { ListBranchPatientsQueryDto } from './dto/list-branch-patients-query.dto.js';
import { paginated } from '@common/utils/pagination.utils.js';
import { PatientOrgEnrollmentStatus } from '@prisma/client';
import { DEFAULT_PATIENT_PAGE_SIZE } from './patients.constants.js';
import { toEpisodeSummary } from './patients.mapper.js';
import { CarePathStatDto, PatientStatsDto } from './dto/patient-stats.dto.js';

@Injectable()
export class PatientsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly patientAccessService: PatientAccessService,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Whether the caller should see the full clinician view (active journey +
   * episodes) rather than the trimmed episode list. True for org OWNERs and for
   * any profile holding a clinical job function (OBGYN, doctors, nurses, …).
   */
  private async isClinicalViewer(user: AuthContext): Promise<boolean> {
    return (
      user.roles.includes('OWNER') ||
      this.authorizationService.isClinical(user.profileId)
    );
  }

  async create(dto: CreatePatientDto) {
    return this.prismaService.db.patient.create({
      data: {
        full_name: dto.full_name,
        date_of_birth: new Date(dto.date_of_birth),
        national_id: dto.national_id,
        phone_number: dto.phone_number,
        address: dto.address,
      },
    });
  }

  async findAll(query: ListPatientsQueryDto, user: AuthContext) {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PATIENT_PAGE_SIZE;
    const isClinicalViewer = await this.isClinicalViewer(user);

    const where = {
      is_deleted: false,
      enrollments: {
        some: {
          organization_id: user.organizationId,
          status: {
            in: ['ACTIVE', 'DISCHARGED'] as PatientOrgEnrollmentStatus[],
          },
          is_deleted: false,
        },
      },
      ...(query.search
        ? {
            OR: [
              {
                full_name: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
              { national_id: { contains: query.search } },
              { phone_number: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [patients, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.patient.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          journeys: {
            where: {
              organization_id: user.organizationId,
              status: 'ACTIVE',
              is_deleted: false,
            },
            orderBy: { started_at: 'desc' },
            take: 1,
            include: {
              episodes: {
                where: { is_deleted: false },
                orderBy: { order: 'asc' },
              },
              care_path: { select: { code: true } },
            },
          },
        },
      }),
      this.prismaService.db.patient.count({ where }),
    ]);

    const shaped = patients.map((patient) => {
      const { journeys, ...rest } = patient;
      const activeJourney = journeys[0] ?? null;
      const activeCarePathCode = activeJourney?.care_path?.code;
      const carePathField = activeCarePathCode
        ? { active_care_path_code: activeCarePathCode }
        : {};
      if (isClinicalViewer) {
        return {
          ...rest,
          active_journey: activeJourney,
          ...carePathField,
        };
      }
      return {
        ...rest,
        active_episodes: activeJourney
          ? activeJourney.episodes.map(toEpisodeSummary)
          : [],
        ...carePathField,
      };
    });

    return paginated(shaped, { page, limit, total });
  }

  async findAllForBranch(
    branchId: string,
    query: ListBranchPatientsQueryDto,
    user: AuthContext,
  ) {
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      user.organizationId,
      branchId,
    );

    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PATIENT_PAGE_SIZE;

    const journeyWhere = {
      organization_id: user.organizationId,
      is_deleted: false,
      ...(query.journey_status && { status: query.journey_status }),
      ...(query.journey_type && {
        journey_template: { type: query.journey_type },
      }),
    };

    // F5 — a patient counts as "in this org" only after a visit at this branch
    // has actually been checked in. Pre-checkin bookings (and pure cancels)
    // are not surfaced in the org's branch patient list.
    const branchVisitFilter = {
      some: {
        is_deleted: false,
        visits: {
          some: {
            branch_id: branchId,
            is_deleted: false,
            checked_in_at: { not: null },
          },
        },
      },
    };

    const where = {
      is_deleted: false,
      journeys: {
        some: {
          ...journeyWhere,
          episodes: branchVisitFilter,
        },
      },
      ...(query.search && {
        OR: [
          {
            full_name: {
              contains: query.search,
              mode: 'insensitive' as const,
            },
          },
          { national_id: { contains: query.search } },
        ],
      }),
    };

    const [patients, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.patient.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          journeys: {
            where: {
              ...journeyWhere,
              episodes: branchVisitFilter,
            },
            take: 1,
            orderBy: { started_at: 'desc' },
            include: {
              journey_template: { select: { type: true } },
            },
          },
        },
      }),
      this.prismaService.db.patient.count({ where }),
    ]);

    const patientIds = patients.map((p) => p.id);
    const lastVisitMap = await this.getLastVisitDates(patientIds, branchId);

    const shaped = await Promise.all(
      patients.map(async ({ journeys, profile_image_object_key, ...rest }) => {
        const j = journeys[0] ?? null;
        return {
          ...rest,
          journey: j
            ? { id: j.id, type: j.journey_template.type, status: j.status }
            : null,
          last_visit_date: lastVisitMap.get(rest.id) ?? null,
          profile_image_url: profile_image_object_key
            ? await this.storageService.createPresignedDownloadUrl(
                profile_image_object_key,
              )
            : null,
        };
      }),
    );

    return paginated(shaped, { page, limit, total });
  }

  /**
   * OWNER-only org-wide directory: every patient with a journey in the org,
   * across all branches. Returns the same {@link BranchPatientDto} shape as
   * {@link findAllForBranch} (journey + last_visit_date) so the frontend list
   * reuses one mapper; `last_visit_date` is the most recent COMPLETED visit at
   * any branch.
   */
  async findAllForOrg(query: ListBranchPatientsQueryDto, user: AuthContext) {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      user.organizationId,
    );

    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PATIENT_PAGE_SIZE;

    const journeyWhere = {
      organization_id: user.organizationId,
      is_deleted: false,
      ...(query.journey_status && { status: query.journey_status }),
      ...(query.journey_type && {
        journey_template: { type: query.journey_type },
      }),
    };

    const where = {
      is_deleted: false,
      journeys: { some: journeyWhere },
      ...(query.search && {
        OR: [
          {
            full_name: {
              contains: query.search,
              mode: 'insensitive' as const,
            },
          },
          { national_id: { contains: query.search } },
        ],
      }),
    };

    const [patients, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.patient.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          journeys: {
            where: journeyWhere,
            take: 1,
            orderBy: { started_at: 'desc' },
            include: { journey_template: { select: { type: true } } },
          },
        },
      }),
      this.prismaService.db.patient.count({ where }),
    ]);

    const lastVisitMap = await this.getLastVisitDates(
      patients.map((p) => p.id),
      null,
    );

    const shaped = await Promise.all(
      patients.map(async ({ journeys, profile_image_object_key, ...rest }) => {
        const j = journeys[0] ?? null;
        return {
          ...rest,
          journey: j
            ? { id: j.id, type: j.journey_template.type, status: j.status }
            : null,
          last_visit_date: lastVisitMap.get(rest.id) ?? null,
          profile_image_url: profile_image_object_key
            ? await this.storageService.createPresignedDownloadUrl(
                profile_image_object_key,
              )
            : null,
        };
      }),
    );

    return paginated(shaped, { page, limit, total });
  }

  private async getLastVisitDates(
    patientIds: string[],
    branchId: string | null,
  ): Promise<Map<string, Date>> {
    if (patientIds.length === 0) return new Map();

    const visits = await this.prismaService.db.visit.findMany({
      where: {
        ...(branchId ? { branch_id: branchId } : {}),
        is_deleted: false,
        status: 'COMPLETED',
        episode: {
          is_deleted: false,
          journey: { patient_id: { in: patientIds }, is_deleted: false },
        },
      },
      select: {
        scheduled_at: true,
        episode: { select: { journey: { select: { patient_id: true } } } },
      },
      orderBy: { scheduled_at: 'desc' },
    });

    const map = new Map<string, Date>();
    for (const v of visits) {
      const pid = v.episode.journey.patient_id;
      if (!map.has(pid)) map.set(pid, v.scheduled_at);
    }
    return map;
  }

  async findOne(id: string, user: AuthContext) {
    await this.patientAccessService.assertPatientAccessible(id, user);
    const patient = await this.prismaService.db.patient.findUnique({
      where: { id, is_deleted: false },
    });
    if (!patient) throw new NotFoundException(`Patient ${id} not found`);
    return patient;
  }

  async update(id: string, dto: UpdatePatientDto, user: AuthContext) {
    await this.findOne(id, user);
    return this.prismaService.db.patient.update({
      where: { id },
      data: {
        ...(dto.full_name !== undefined && { full_name: dto.full_name }),
        ...(dto.date_of_birth !== undefined && {
          date_of_birth: new Date(dto.date_of_birth),
        }),
        ...(dto.phone_number !== undefined && {
          phone_number: dto.phone_number,
        }),
        ...(dto.address !== undefined && { address: dto.address }),
      },
    });
  }

  /**
   * Patient analytics for a branch: a total count plus a per-care-path breakdown,
   * each with the value as it stood at the start of this month (for the
   * month-over-month trend). Branch membership mirrors {@link findAllForBranch}.
   */
  async getBranchStats(
    branchId: string,
    user: AuthContext,
    assignedToMe = false,
  ): Promise<PatientStatsDto> {
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      user.organizationId,
      branchId,
    );
    return this.computePatientStats(user.organizationId, branchId, {
      assignedDoctorId: assignedToMe ? user.profileId : undefined,
    });
  }

  /**
   * OWNER-only org-wide patient analytics — same shape as {@link getBranchStats}
   * but counting every patient with a journey in the org, across all branches.
   */
  async getOrgStats(user: AuthContext): Promise<PatientStatsDto> {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      user.organizationId,
    );
    return this.computePatientStats(user.organizationId, null);
  }

  /** Local-time first day of the current month — the trend comparison baseline. */
  private startOfCurrentMonth(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  /** Local-time first day of the previous month — baseline for "new last month". */
  private startOfPreviousMonth(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() - 1, 1);
  }

  /**
   * Shared engine for {@link getBranchStats} / {@link getOrgStats}. The care-path
   * breakdown is **discovered from the data** (a `groupBy` over the qualifying
   * journeys' template ids) rather than enumerated, so it adapts to whatever
   * specialties the org runs. `branchId === null` ⇒ org-wide (no branch-checkin
   * requirement). `previous` re-runs each count with a start-of-month cutoff.
   */
  private async computePatientStats(
    organizationId: string,
    branchId: string | null,
    opts: { assignedDoctorId?: string } = {},
  ): Promise<PatientStatsDto> {
    const db = this.prismaService.db;
    const cutoff = this.startOfCurrentMonth();
    const prevCutoff = this.startOfPreviousMonth();

    // A journey only counts for a branch once one of its episodes has a visit
    // that was actually checked in at the branch (mirrors findAllForBranch). For
    // the previous snapshot, that check-in must predate the cutoff. When a doctor
    // views their personal stats, "my patients" are those whose qualifying visit
    // was assigned to them.
    const branchEpisodeFilter = (checkinUpTo?: Date) => ({
      some: {
        is_deleted: false,
        visits: {
          some: {
            branch_id: branchId!,
            is_deleted: false,
            ...(opts.assignedDoctorId
              ? { assigned_doctor_id: opts.assignedDoctorId }
              : {}),
            checked_in_at: checkinUpTo
              ? { not: null, lte: checkinUpTo }
              : { not: null },
          },
        },
      },
    });

    const journeyWhere = (opts: { templateId?: string; cutoff?: Date }) => ({
      organization_id: organizationId,
      is_deleted: false,
      ...(opts.templateId ? { journey_template_id: opts.templateId } : {}),
      ...(opts.cutoff ? { started_at: { lte: opts.cutoff } } : {}),
      ...(branchId ? { episodes: branchEpisodeFilter(opts.cutoff) } : {}),
    });

    const patientWhere = (opts: { templateId?: string; cutoff?: Date }) => ({
      is_deleted: false,
      journeys: { some: journeyWhere(opts) },
    });

    // 1. Which journey templates are actually present among qualifying journeys.
    const groups = await db.patientJourney.groupBy({
      by: ['journey_template_id'],
      where: journeyWhere({}),
    });
    const templateIds = groups.map((g) => g.journey_template_id);

    // 2. Resolve each template's display name + owning specialty + type hint.
    const templates = templateIds.length
      ? await db.journeyTemplate.findMany({
          where: { id: { in: templateIds } },
          select: {
            id: true,
            name: true,
            type: true,
            specialty: { select: { id: true, name: true } },
          },
        })
      : [];

    // 3. One round trip: total (current + previous), patients at the start of the
    //    previous month (for the "new this month" trend), then each template's pair.
    const [totalCurrent, totalPrevious, totalPrevPrev, ...perTemplate] =
      await db.$transaction([
        db.patient.count({ where: patientWhere({}) }),
        db.patient.count({ where: patientWhere({ cutoff }) }),
        db.patient.count({ where: patientWhere({ cutoff: prevCutoff }) }),
        ...templates.flatMap((tpl) => [
          db.patient.count({ where: patientWhere({ templateId: tpl.id }) }),
          db.patient.count({
            where: patientWhere({ templateId: tpl.id, cutoff }),
          }),
        ]),
      ]);

    const by_care_path: CarePathStatDto[] = templates
      .map((tpl, i) => ({
        journey_template_id: tpl.id,
        name: tpl.name,
        specialty_id: tpl.specialty.id,
        specialty_name: tpl.specialty.name,
        type: tpl.type,
        current: perTemplate[i * 2] ?? 0,
        previous: perTemplate[i * 2 + 1] ?? 0,
      }))
      .filter((c) => c.current > 0)
      .sort((a, b) => b.current - a.current);

    return {
      total: { current: totalCurrent, previous: totalPrevious },
      new_this_month: {
        current: totalCurrent - totalPrevious,
        previous: totalPrevious - totalPrevPrev,
      },
      by_care_path,
    };
  }
}
