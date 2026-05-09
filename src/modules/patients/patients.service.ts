import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { ListPatientsQueryDto } from './dto/list-patients-query.dto';
import { ListBranchPatientsQueryDto } from './dto/list-branch-patients-query.dto';
import { paginated } from '../../common/utils/pagination.utils';

@Injectable()
export class PatientsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async create(dto: CreatePatientDto) {
    return this.prismaService.db.patient.create({
      data: {
        full_name: dto.full_name,
        husband_name: dto.husband_name ?? null,
        date_of_birth: new Date(dto.date_of_birth),
        national_id: dto.national_id,
        phone_number: dto.phone_number,
        address: dto.address,
      },
    });
  }

  async findAll(query: ListPatientsQueryDto, user: AuthContext) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const isClinicianRole =
      user.roles.includes('DOCTOR') || user.roles.includes('OWNER');

    const where = {
      is_deleted: false,
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
            take: 1,
            include: {
              episodes: {
                where: { is_deleted: false },
                orderBy: { order: 'asc' },
              },
            },
          },
        },
      }),
      this.prismaService.db.patient.count({ where }),
    ]);

    const shaped = patients.map((patient) => {
      const { journeys, ...rest } = patient;
      const activeJourney = journeys[0] ?? null;
      if (isClinicianRole) {
        return { ...rest, active_journey: activeJourney };
      }
      return {
        ...rest,
        active_episodes: activeJourney
          ? activeJourney.episodes.map((e) => ({
              id: e.id,
              name: e.name,
              order: e.order,
            }))
          : [],
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
    const limit = query.limit ?? 20;

    const journeyWhere = {
      organization_id: user.organizationId,
      is_deleted: false,
      ...(query.journey_status && { status: query.journey_status }),
      ...(query.journey_type && {
        journey_template: { type: query.journey_type },
      }),
    };

    const branchVisitFilter = {
      some: {
        is_deleted: false,
        visits: { some: { branch_id: branchId, is_deleted: false } },
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

  async findOne(id: string) {
    const patient = await this.prismaService.db.patient.findUnique({
      where: { id, is_deleted: false },
    });
    if (!patient) throw new NotFoundException(`Patient ${id} not found`);
    return patient;
  }

  async update(id: string, dto: UpdatePatientDto) {
    await this.findOne(id);
    return this.prismaService.db.patient.update({
      where: { id },
      data: {
        ...(dto.full_name !== undefined && { full_name: dto.full_name }),
        ...(dto.husband_name !== undefined && {
          husband_name: dto.husband_name,
        }),
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
