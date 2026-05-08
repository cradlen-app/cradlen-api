import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, VisitStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CreateVisitDto } from './dto/create-visit.dto';
import { UpdateVisitDto } from './dto/update-visit.dto';
import { UpdateVisitStatusDto } from './dto/update-visit-status.dto';
import { BookVisitDto } from './dto/book-visit.dto';
import { VisitsGateway } from './visits.gateway';
import { paginated } from '../../common/utils/pagination.utils';

const TERMINAL_STATES: VisitStatus[] = ['COMPLETED', 'CANCELLED', 'NO_SHOW'];

const VALID_TRANSITIONS: Record<VisitStatus, VisitStatus[]> = {
  SCHEDULED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

const STATUS_TIMESTAMPS: Partial<Record<VisitStatus, string>> = {
  CHECKED_IN: 'checked_in_at',
  IN_PROGRESS: 'started_at',
  COMPLETED: 'completed_at',
};

@Injectable()
export class VisitsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly visitsGateway: VisitsGateway,
  ) {}

  private async getNextQueueNumber(
    tx: Prisma.TransactionClient,
    assignedDoctorId: string,
    branchId: string,
    date: Date,
  ): Promise<number> {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const last = await tx.visit.findFirst({
      where: {
        assigned_doctor_id: assignedDoctorId,
        branch_id: branchId,
        checked_in_at: { gte: dayStart, lte: dayEnd },
        is_deleted: false,
      },
      orderBy: { queue_number: 'desc' },
      select: { queue_number: true },
    });

    return (last?.queue_number ?? 0) + 1;
  }

  private async assertEpisodeInOrg(episodeId: string, organizationId: string) {
    const episode = await this.prismaService.db.patientEpisode.findUnique({
      where: { id: episodeId, is_deleted: false },
      include: { journey: { select: { organization_id: true } } },
    });
    if (
      !episode ||
      !episode.journey ||
      episode.journey.organization_id !== organizationId
    ) {
      throw new NotFoundException(`Episode ${episodeId} not found`);
    }
    return episode;
  }

  async create(episodeId: string, dto: CreateVisitDto, user: AuthContext) {
    await this.assertEpisodeInOrg(episodeId, user.organizationId);
    const branchId = dto.branch_id ?? user.activeBranchId;
    if (!branchId) throw new BadRequestException('branch_id is required');
    return this.prismaService.db.visit.create({
      data: {
        episode_id: episodeId,
        assigned_doctor_id: dto.assigned_doctor_id,
        branch_id: branchId,
        visit_type: dto.visit_type,
        priority: dto.priority,
        scheduled_at: new Date(dto.scheduled_at),
        notes: dto.notes ?? null,
        created_by_id: user.profileId,
      },
    });
  }

  async bookVisit(dto: BookVisitDto, user: AuthContext) {
    if (!dto.patient_id) {
      const required = [
        'national_id',
        'full_name',
        'date_of_birth',
        'phone_number',
        'address',
      ] as const;
      const missing = required.filter((f) => !dto[f]);
      if (missing.length) {
        throw new BadRequestException(
          'Either patient_id or all new-patient fields (national_id, full_name, date_of_birth, phone_number, address) must be provided',
        );
      }
    }
    if (dto.is_married && !dto.husband_name) {
      throw new BadRequestException(
        'husband_name is required when is_married is true',
      );
    }
    const branchId = dto.branch_id ?? user.activeBranchId;
    if (!branchId) throw new BadRequestException('branch_id is required');

    const template = await this.prismaService.db.journeyTemplate.findFirst({
      where: { type: 'GENERAL_GYN', is_deleted: false },
      include: {
        episodes: { where: { is_deleted: false }, orderBy: { order: 'asc' } },
      },
    });
    if (!template || !template.episodes.length) {
      throw new NotFoundException(
        'GENERAL_GYN journey template not configured',
      );
    }
    const firstEpisodeTemplate = template.episodes[0];

    const result = await this.prismaService.db.$transaction(async (tx) => {
      let patient;
      if (dto.patient_id) {
        patient = await tx.patient.findUnique({
          where: { id: dto.patient_id, is_deleted: false },
        });
        if (!patient)
          throw new NotFoundException(`Patient ${dto.patient_id} not found`);
      } else {
        const existing = await tx.patient.findUnique({
          where: { national_id: dto.national_id! },
        });
        if (existing && !existing.is_deleted) {
          throw new ConflictException(
            'A patient with this national_id already exists',
          );
        }
        patient = await tx.patient.create({
          data: {
            full_name: dto.full_name!,
            national_id: dto.national_id!,
            date_of_birth: new Date(dto.date_of_birth!),
            phone_number: dto.phone_number!,
            address: dto.address!,
            husband_name:
              dto.is_married && dto.husband_name ? dto.husband_name : null,
          },
        });
      }

      let journey = await tx.patientJourney.findFirst({
        where: {
          patient_id: patient.id,
          organization_id: user.organizationId,
          journey_template_id: template.id,
          status: 'ACTIVE',
          is_deleted: false,
        },
      });

      let episode;
      if (journey) {
        episode = await tx.patientEpisode.findFirst({
          where: {
            journey_id: journey.id,
            episode_template_id: firstEpisodeTemplate.id,
            is_deleted: false,
          },
        });
        if (!episode)
          throw new NotFoundException('General Consultation episode not found');
      } else {
        journey = await tx.patientJourney.create({
          data: {
            patient_id: patient.id,
            organization_id: user.organizationId,
            journey_template_id: template.id,
            created_by_id: user.profileId,
            status: 'ACTIVE',
          },
        });
        await tx.patientEpisode.createMany({
          data: template.episodes.map((ep, index) => ({
            journey_id: journey!.id,
            episode_template_id: ep.id,
            name: ep.name,
            order: ep.order,
            status: index === 0 ? ('ACTIVE' as const) : ('PENDING' as const),
            started_at: index === 0 ? new Date() : null,
          })),
        });
        episode = await tx.patientEpisode.findFirst({
          where: {
            journey_id: journey.id,
            episode_template_id: firstEpisodeTemplate.id,
            is_deleted: false,
          },
        });
        if (!episode)
          throw new NotFoundException('General Consultation episode not found');
      }

      const visit = await tx.visit.create({
        data: {
          episode_id: episode.id,
          assigned_doctor_id: dto.assigned_doctor_id,
          branch_id: branchId,
          visit_type: dto.visit_type,
          priority: dto.priority,
          scheduled_at: new Date(dto.scheduled_at),
          notes: dto.notes ?? null,
          created_by_id: user.profileId,
        },
      });

      return { visit, episode: episode, journey, patient };
    });

    this.visitsGateway.emitVisitBooked(dto.assigned_doctor_id, result);
    return result;
  }

  async findAllForEpisode(
    episodeId: string,
    user: AuthContext,
    query: { page?: number; limit?: number },
  ) {
    await this.assertEpisodeInOrg(episodeId, user.organizationId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = { episode_id: episodeId, is_deleted: false };
    const [visits, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.visit.findMany({
        where,
        orderBy: { scheduled_at: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaService.db.visit.count({ where }),
    ]);
    return paginated(visits, { page, limit, total });
  }

  async findAllForBranch(
    branchId: string,
    status: VisitStatus,
    query: { page?: number; limit?: number; from?: string; to?: string },
    user: AuthContext,
  ) {
    const branch = await this.prismaService.db.branch.findFirst({
      where: {
        id: branchId,
        organization_id: user.organizationId,
        is_deleted: false,
      },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException(`Branch ${branchId} not found`);

    const isOwner = user.roles.includes('OWNER');
    const isInBranch = user.branchIds.includes(branchId);
    if (!isOwner && !isInBranch) {
      throw new ForbiddenException('Access denied');
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      branch_id: branchId,
      status,
      is_deleted: false,
      ...(query.from &&
        query.to && {
          scheduled_at: {
            gte: new Date(query.from),
            lte: new Date(query.to),
          },
        }),
    };

    const orderBy =
      status === 'CHECKED_IN'
        ? { queue_number: 'asc' as const }
        : { scheduled_at: 'asc' as const };

    const [visits, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.visit.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          assigned_doctor: {
            select: {
              id: true,
              specialty: true,
              user: { select: { id: true, first_name: true, last_name: true } },
            },
          },
          episode: {
            select: {
              id: true,
              journey: {
                select: {
                  patient: { select: { id: true, full_name: true } },
                },
              },
            },
          },
        },
      }),
      this.prismaService.db.visit.count({ where }),
    ]);

    return paginated(visits, { page, limit, total });
  }

  private todayBounds() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  private listInclude = {
    assigned_doctor: {
      select: {
        id: true,
        specialty: true,
        user: { select: { id: true, first_name: true, last_name: true } },
      },
    },
    episode: {
      select: {
        id: true,
        journey: {
          select: {
            patient: { select: { id: true, full_name: true } },
          },
        },
      },
    },
  } as const;

  private async assertBranchAccess(branchId: string, user: AuthContext) {
    const branch = await this.prismaService.db.branch.findFirst({
      where: {
        id: branchId,
        organization_id: user.organizationId,
        is_deleted: false,
      },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException(`Branch ${branchId} not found`);

    const isOwner = user.roles.includes('OWNER');
    const isInBranch = user.branchIds.includes(branchId);
    if (!isOwner && !isInBranch) {
      throw new ForbiddenException('Access denied');
    }
  }

  async findBranchWaitingList(
    branchId: string,
    query: { page?: number; limit?: number },
    user: AuthContext,
  ) {
    await this.assertBranchAccess(branchId, user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { start, end } = this.todayBounds();
    const where: Prisma.VisitWhereInput = {
      branch_id: branchId,
      is_deleted: false,
      status: { in: ['SCHEDULED', 'CHECKED_IN'] },
      scheduled_at: { gte: start, lte: end },
    };

    const [visits, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.visit.findMany({
        where,
        orderBy: [
          { status: 'asc' },
          { queue_number: 'asc' },
          { scheduled_at: 'asc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
        include: this.listInclude,
      }),
      this.prismaService.db.visit.count({ where }),
    ]);
    return paginated(visits, { page, limit, total });
  }

  async findBranchInProgress(
    branchId: string,
    query: { page?: number; limit?: number },
    user: AuthContext,
  ) {
    await this.assertBranchAccess(branchId, user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { start, end } = this.todayBounds();
    const where: Prisma.VisitWhereInput = {
      branch_id: branchId,
      is_deleted: false,
      status: 'IN_PROGRESS',
      started_at: { gte: start, lte: end },
    };

    const [visits, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.visit.findMany({
        where,
        orderBy: { started_at: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: this.listInclude,
      }),
      this.prismaService.db.visit.count({ where }),
    ]);
    return paginated(visits, { page, limit, total });
  }

  async findMyWaitingList(
    query: { page?: number; limit?: number },
    user: AuthContext,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { start, end } = this.todayBounds();
    const where: Prisma.VisitWhereInput = {
      assigned_doctor_id: user.profileId,
      is_deleted: false,
      status: { in: ['SCHEDULED', 'CHECKED_IN'] },
      scheduled_at: { gte: start, lte: end },
    };

    const [visits, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.visit.findMany({
        where,
        orderBy: [
          { status: 'asc' },
          { queue_number: 'asc' },
          { scheduled_at: 'asc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
        include: this.listInclude,
      }),
      this.prismaService.db.visit.count({ where }),
    ]);
    return paginated(visits, { page, limit, total });
  }

  async findMyCurrent(user: AuthContext) {
    const visit = await this.prismaService.db.visit.findFirst({
      where: {
        assigned_doctor_id: user.profileId,
        status: 'IN_PROGRESS',
        is_deleted: false,
      },
      orderBy: { started_at: 'desc' },
      include: this.listInclude,
    });
    return { data: visit };
  }

  async findOne(id: string, user: AuthContext) {
    const visit = await this.prismaService.db.visit.findUnique({
      where: { id, is_deleted: false },
      include: {
        episode: {
          include: { journey: { select: { organization_id: true } } },
        },
      },
    });
    if (
      !visit ||
      !visit.episode?.journey ||
      visit.episode.journey.organization_id !== user.organizationId
    ) {
      throw new NotFoundException(`Visit ${id} not found`);
    }
    return visit;
  }

  async update(id: string, dto: UpdateVisitDto, user: AuthContext) {
    const visit = await this.findOne(id, user);
    if (TERMINAL_STATES.includes(visit.status)) {
      throw new BadRequestException(
        `Cannot update a visit in terminal status: ${visit.status}`,
      );
    }
    return this.prismaService.db.visit.update({
      where: { id },
      data: {
        ...(dto.assigned_doctor_id !== undefined && {
          assigned_doctor_id: dto.assigned_doctor_id,
        }),
        ...(dto.branch_id !== undefined && { branch_id: dto.branch_id }),
        ...(dto.visit_type !== undefined && { visit_type: dto.visit_type }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.scheduled_at !== undefined && {
          scheduled_at: new Date(dto.scheduled_at),
        }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
  }

  async updateStatus(id: string, dto: UpdateVisitStatusDto, user: AuthContext) {
    const visit = await this.findOne(id, user);
    const allowedNext = VALID_TRANSITIONS[visit.status];
    if (!allowedNext.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition from ${visit.status} to ${dto.status}`,
      );
    }
    const timestampField = STATUS_TIMESTAMPS[dto.status];
    const now = new Date();

    const updatedVisit = await this.prismaService.db.$transaction(
      async (tx) => {
        const queueNumber =
          dto.status === 'CHECKED_IN'
            ? await this.getNextQueueNumber(
                tx,
                visit.assigned_doctor_id,
                visit.branch_id,
                now,
              )
            : undefined;

        return tx.visit.update({
          where: { id },
          data: {
            status: dto.status,
            ...(timestampField ? { [timestampField]: now } : {}),
            ...(queueNumber !== undefined ? { queue_number: queueNumber } : {}),
          },
        });
      },
    );

    this.visitsGateway.emitVisitStatusUpdated(
      updatedVisit.assigned_doctor_id,
      updatedVisit,
    );
    return updatedVisit;
  }
}
