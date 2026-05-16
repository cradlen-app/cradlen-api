import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ERROR_CODES } from '@common/constant/error-codes.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prismaService: PrismaService) {}

  async assertBranchLimit(organizationId: string): Promise<void> {
    const plan = await this.getActivePlan(organizationId);
    const current = await this.prismaService.db.branch.count({
      where: { organization_id: organizationId, is_deleted: false },
    });
    if (current >= plan.max_branches) {
      throw new ForbiddenException({
        code: ERROR_CODES.SUBSCRIPTION_LIMIT_REACHED,
        message: `Branch limit reached (${plan.max_branches}). Upgrade your plan.`,
        details: { resource: 'branches', limit: plan.max_branches, current },
      });
    }
  }

  async assertStaffLimit(organizationId: string): Promise<void> {
    const plan = await this.getActivePlan(organizationId);
    const [activeStaff, pendingInvitations] = await Promise.all([
      this.prismaService.db.profile.count({
        where: {
          organization_id: organizationId,
          is_deleted: false,
          is_active: true,
        },
      }),
      this.prismaService.db.invitation.count({
        where: {
          organization_id: organizationId,
          is_deleted: false,
          status: 'PENDING',
        },
      }),
    ]);
    const current = activeStaff + pendingInvitations;
    if (current >= plan.max_staff) {
      throw new ForbiddenException({
        code: ERROR_CODES.SUBSCRIPTION_LIMIT_REACHED,
        message: `Staff limit reached (${plan.max_staff}). Upgrade your plan.`,
        details: { resource: 'staff', limit: plan.max_staff, current },
      });
    }
  }

  async assertOrganizationLimit(userId: string): Promise<void> {
    const ownerRole = await this.prismaService.db.role.findUnique({
      where: { code: 'OWNER' },
    });
    if (!ownerRole)
      throw new InternalServerErrorException('OWNER role not seeded');

    const ownedOrganizationIds = await this.prismaService.db.profile
      .findMany({
        where: {
          user_id: userId,
          is_deleted: false,
          is_active: true,
          roles: { some: { role_id: ownerRole.id } },
          organization: { is_deleted: false, status: 'ACTIVE' },
        },
        select: { organization_id: true },
      })
      .then((rows) => rows.map((r) => r.organization_id));

    const current = ownedOrganizationIds.length;

    let maxAllowed: number;
    if (ownedOrganizationIds.length > 0) {
      const subs = await this.prismaService.db.subscription.findMany({
        where: {
          organization_id: { in: ownedOrganizationIds },
          is_deleted: false,
        },
        select: { subscription_plan: { select: { max_organizations: true } } },
      });
      maxAllowed = Math.max(
        ...subs.map((s) => s.subscription_plan.max_organizations),
        0,
      );
    } else {
      const freePlan = await this.prismaService.db.subscriptionPlan.findUnique({
        where: { plan: 'free_trial' },
      });
      if (!freePlan)
        throw new InternalServerErrorException('Free trial plan not seeded');
      maxAllowed = freePlan.max_organizations;
    }

    if (current >= maxAllowed) {
      throw new ForbiddenException({
        code: ERROR_CODES.SUBSCRIPTION_LIMIT_REACHED,
        message: `Organization limit reached (${maxAllowed}). Upgrade your plan.`,
        details: { resource: 'organizations', limit: maxAllowed, current },
      });
    }
  }

  private async getActivePlan(organizationId: string) {
    const sub = await this.prismaService.db.subscription.findFirst({
      where: { organization_id: organizationId, is_deleted: false },
      include: { subscription_plan: true },
      orderBy: { created_at: 'desc' },
    });
    if (!sub)
      throw new NotFoundException(
        'No active subscription found for organization',
      );
    return sub.subscription_plan;
  }
}
