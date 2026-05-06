import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { VisitStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CreateVisitDto } from './dto/create-visit.dto';
import { UpdateVisitDto } from './dto/update-visit.dto';
import { UpdateVisitStatusDto } from './dto/update-visit-status.dto';
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
  constructor(private readonly prismaService: PrismaService) {}

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
    return this.prismaService.db.visit.update({
      where: { id },
      data: {
        status: dto.status,
        ...(timestampField ? { [timestampField]: new Date() } : {}),
      },
    });
  }
}
