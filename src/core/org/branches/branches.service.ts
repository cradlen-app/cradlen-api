import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MedicalRepVisitStatus, Prisma, VisitStatus } from '@prisma/client';
import { ERROR_CODES } from '@common/constant/error-codes.js';
import { paginated } from '@common/utils/pagination.utils.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import { BRANCH_EVENTS, type BranchChangedPayload } from './branches.events.js';
import { toBranchResponse, toBranchResponseList } from './branches.mapper.js';
import type {
  CreateBranchDto,
  ListBranchesQueryDto,
  UpdateBranchDto,
} from './dto/branch.dto.js';

/** Non-terminal visit statuses that block branch deletion. */
const ACTIVE_VISIT_STATUSES: VisitStatus[] = [
  VisitStatus.SCHEDULED,
  VisitStatus.CHECKED_IN,
  VisitStatus.IN_PROGRESS,
];

const ACTIVE_REP_VISIT_STATUSES: MedicalRepVisitStatus[] = [
  MedicalRepVisitStatus.SCHEDULED,
  MedicalRepVisitStatus.CHECKED_IN,
  MedicalRepVisitStatus.IN_PROGRESS,
];

@Injectable()
export class BranchesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly organizationsService: OrganizationsService,
    private readonly eventBus: EventBus,
  ) {}

  async listBranches(
    profileId: string,
    organizationId: string,
    query: ListBranchesQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    // Authority mirrors the per-branch routes: OWNER sees every branch;
    // branch-scoped managers see only the branches they manage.
    const isOwner = await this.authorizationService.isOwner(
      profileId,
      organizationId,
    );
    const where: Prisma.BranchWhereInput = {
      organization_id: organizationId,
      is_deleted: false,
    };
    if (!isOwner) {
      if (
        !(await this.authorizationService.canManageStaff(
          profileId,
          organizationId,
        ))
      ) {
        throw new ForbiddenException('Branch management access denied');
      }
      const branchIds = await this.authorizationService.getEffectiveBranchIds(
        profileId,
        organizationId,
      );
      where.id = { in: branchIds };
    }

    const [items, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.branch.findMany({
        where,
        orderBy: [{ is_main: 'desc' }, { created_at: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaService.db.branch.count({ where }),
    ]);

    return paginated(toBranchResponseList(items), { page, limit, total });
  }

  async createBranch(
    profileId: string,
    organizationId: string,
    dto: CreateBranchDto,
  ) {
    await this.authorizationService.assertCanManageOrganization(
      profileId,
      organizationId,
    );
    const branch = await this.prismaService.db.$transaction(async (tx) => {
      // Re-check the plan limit inside the transaction so concurrent
      // creates can't both slip past a stale count.
      await this.subscriptionsService.assertBranchLimit(organizationId, tx);
      if (dto.is_main) {
        await this.demoteOtherMains(tx, organizationId);
      }
      return tx.branch.create({
        data: {
          organization_id: organizationId,
          name: dto.name,
          address: dto.address,
          city: dto.city,
          governorate: dto.governorate,
          country: dto.country,
          is_main: dto.is_main ?? false,
        },
      });
    });

    this.eventBus.publish<BranchChangedPayload>(BRANCH_EVENTS.created, {
      id: branch.id,
      organization_id: organizationId,
      is_main: branch.is_main,
    });
    return toBranchResponse(branch);
  }

  async getBranch(profileId: string, organizationId: string, branchId: string) {
    await this.authorizationService.assertCanManageBranch(
      profileId,
      organizationId,
      branchId,
    );
    return toBranchResponse(
      await this.getBranchOrThrow(organizationId, branchId),
    );
  }

  async updateBranch(
    profileId: string,
    organizationId: string,
    branchId: string,
    dto: UpdateBranchDto,
  ) {
    await this.authorizationService.assertCanManageBranch(
      profileId,
      organizationId,
      branchId,
    );
    const branch = await this.getBranchOrThrow(organizationId, branchId);
    if (branch.is_main && dto.is_main === false) {
      throw new BadRequestException('At least one branch must remain main');
    }

    const updated = await this.prismaService.db.$transaction(async (tx) => {
      if (dto.is_main) {
        await this.demoteOtherMains(tx, organizationId, branchId);
      }
      return tx.branch.update({
        where: { id: branchId },
        data: this.buildUpdateData(dto),
      });
    });
    return toBranchResponse(updated);
  }

  async deleteBranch(
    profileId: string,
    organizationId: string,
    branchId: string,
  ) {
    await this.authorizationService.assertCanManageBranch(
      profileId,
      organizationId,
      branchId,
    );
    const branch = await this.getBranchOrThrow(organizationId, branchId);

    const remainingCount = await this.prismaService.db.branch.count({
      where: { organization_id: organizationId, is_deleted: false },
    });

    // Last branch — tear down the whole organization via the canonical path
    // so user-orphan cleanup + refresh-token revocation stay consistent.
    if (remainingCount === 1) {
      await this.organizationsService.deleteOrganization(
        profileId,
        organizationId,
      );
      this.eventBus.publish<BranchChangedPayload>(BRANCH_EVENTS.deleted, {
        id: branchId,
        organization_id: organizationId,
        is_main: branch.is_main,
        organization_deleted: true,
      });
      return;
    }

    // Refuse to orphan clinical records: a branch with open visits can't go.
    await this.assertNoActiveVisits(branchId);

    const now = new Date();
    await this.prismaService.db.$transaction(async (tx) => {
      await tx.branch.update({
        where: { id: branchId },
        data: { is_deleted: true, deleted_at: now },
      });
      // Detach dependent rows that the soft-delete won't cascade to.
      await tx.profileBranch.deleteMany({
        where: { branch_id: branchId, organization_id: organizationId },
      });
      await tx.workingSchedule.deleteMany({ where: { branch_id: branchId } });
      await tx.calendarEvent.updateMany({
        where: { branch_id: branchId },
        data: { branch_id: null },
      });

      if (branch.is_main) {
        // Promote the oldest remaining branch to keep exactly one main.
        const oldest = await tx.branch.findFirst({
          where: {
            organization_id: organizationId,
            id: { not: branchId },
            is_deleted: false,
          },
          orderBy: { created_at: 'asc' },
        });
        if (oldest) {
          await tx.branch.update({
            where: { id: oldest.id },
            data: { is_main: true },
          });
        }
      }
    });

    this.eventBus.publish<BranchChangedPayload>(BRANCH_EVENTS.deleted, {
      id: branchId,
      organization_id: organizationId,
      is_main: branch.is_main,
    });
  }

  private async getBranchOrThrow(organizationId: string, branchId: string) {
    const branch = await this.prismaService.db.branch.findFirst({
      where: {
        id: branchId,
        organization_id: organizationId,
        is_deleted: false,
      },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  private async demoteOtherMains(
    tx: Prisma.TransactionClient,
    organizationId: string,
    exceptId?: string,
  ) {
    await tx.branch.updateMany({
      where: {
        organization_id: organizationId,
        is_deleted: false,
        is_main: true,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { is_main: false },
    });
  }

  private async assertNoActiveVisits(branchId: string) {
    const [visits, repVisits] = await Promise.all([
      this.prismaService.db.visit.count({
        where: {
          branch_id: branchId,
          is_deleted: false,
          status: { in: ACTIVE_VISIT_STATUSES },
        },
      }),
      this.prismaService.db.medicalRepVisit.count({
        where: {
          branch_id: branchId,
          is_deleted: false,
          status: { in: ACTIVE_REP_VISIT_STATUSES },
        },
      }),
    ]);
    const active = visits + repVisits;
    if (active > 0) {
      throw new ConflictException({
        code: ERROR_CODES.CONFLICT,
        message: `Cannot delete a branch with ${active} open visit(s). Complete or cancel them first.`,
        details: { resource: 'visits', active },
      });
    }
  }

  private buildUpdateData(dto: UpdateBranchDto): Prisma.BranchUpdateInput {
    return {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.address !== undefined && { address: dto.address }),
      ...(dto.city !== undefined && { city: dto.city }),
      ...(dto.governorate !== undefined && { governorate: dto.governorate }),
      ...(dto.country !== undefined && { country: dto.country }),
      ...(dto.is_main !== undefined && { is_main: dto.is_main }),
      ...(dto.status !== undefined && { status: dto.status }),
    };
  }
}
