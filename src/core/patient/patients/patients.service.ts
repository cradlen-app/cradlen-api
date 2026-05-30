import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { PatientAccessService } from '@core/clinical/patient-history/patient-access.service.js';
import { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { CreatePatientDto } from './dto/create-patient.dto.js';
import { UpdatePatientDto } from './dto/update-patient.dto.js';
import { ListPatientsQueryDto } from './dto/list-patients-query.dto.js';
import { ListBranchPatientsQueryDto } from './dto/list-branch-patients-query.dto.js';
import { paginated } from '@common/utils/pagination.utils.js';
import { PatientOrgEnrollmentStatus } from '@prisma/client';
import { DEFAULT_PATIENT_PAGE_SIZE } from './patients.constants.js';
import {
  SPOUSE_GUARDIAN_SELECT,
  flattenSpouse,
  toEpisodeSummary,
} from './patients.mapper.js';

@Injectable()
export class PatientsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly patientAccessService: PatientAccessService,
  ) {}

  /**
   * Whether the caller should see the full clinician view (active journey +
   * episodes) rather than the trimmed episode list. True for org OWNERs and for
   * any profile holding a clinical job function (OBGYN, doctors, nurses, …).
   */
  private async isClinicalViewer(user: AuthContext): Promise<boolean> {
    if (user.roles.includes('OWNER')) return true;
    const clinical = await this.prismaService.db.profileJobFunction.findFirst({
      where: {
        profile_id: user.profileId,
        job_function: { is_clinical: true },
      },
      select: { id: true },
    });
    return clinical !== null;
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
          guardian_links: {
            where: { is_deleted: false, relation_to_patient: 'SPOUSE' },
            take: 1,
            include: {
              guardian: { select: SPOUSE_GUARDIAN_SELECT },
            },
          },
        },
      }),
      this.prismaService.db.patient.count({ where }),
    ]);

    const shaped = patients.map((patient) => {
      const { journeys, guardian_links, ...rest } = patient;
      const activeJourney = journeys[0] ?? null;
      const activeCarePathCode = activeJourney?.care_path?.code;
      const carePathField = activeCarePathCode
        ? { active_care_path_code: activeCarePathCode }
        : {};
      const spouseFields = flattenSpouse(guardian_links);
      if (isClinicalViewer) {
        return {
          ...rest,
          active_journey: activeJourney,
          ...carePathField,
          ...spouseFields,
        };
      }
      return {
        ...rest,
        active_episodes: activeJourney
          ? activeJourney.episodes.map(toEpisodeSummary)
          : [],
        ...carePathField,
        ...spouseFields,
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

    const shaped = patients.map(({ journeys, ...rest }) => {
      const j = journeys[0] ?? null;
      return {
        ...rest,
        journey: j
          ? { id: j.id, type: j.journey_template.type, status: j.status }
          : null,
        last_visit_date: lastVisitMap.get(rest.id) ?? null,
      };
    });

    return paginated(shaped, { page, limit, total });
  }

  private async getLastVisitDates(
    patientIds: string[],
    branchId: string,
  ): Promise<Map<string, Date>> {
    if (patientIds.length === 0) return new Map();

    const visits = await this.prismaService.db.visit.findMany({
      where: {
        branch_id: branchId,
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
    await this.patientAccessService.assertPatientInOrg(id, user);
    const patient = await this.prismaService.db.patient.findUnique({
      where: { id, is_deleted: false },
      include: {
        guardian_links: {
          where: { is_deleted: false, relation_to_patient: 'SPOUSE' },
          include: {
            guardian: { select: SPOUSE_GUARDIAN_SELECT },
          },
        },
      },
    });
    if (!patient) throw new NotFoundException(`Patient ${id} not found`);
    const { guardian_links, ...rest } = patient;
    return {
      ...rest,
      ...flattenSpouse(guardian_links),
    };
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
}
