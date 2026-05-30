import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma, SubscriptionStatus } from '@prisma/client';
import { ERROR_CODES } from '@common/constant/error-codes.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

const ACTIVE_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.TRIAL,
  SubscriptionStatus.ACTIVE,
];

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prismaService: PrismaService) {}

  async assertBranchLimit(
    organizationId: string,
    client: Prisma.TransactionClient = this.prismaService.db,
  ): Promise<void> {
    const plan = await this.getActivePlan(organizationId, client);
    const current = await client.branch.count({
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

  async assertStaffLimit(
    organizationId: string,
    client: Prisma.TransactionClient = this.prismaService.db,
  ): Promise<void> {
    const plan = await this.getActivePlan(organizationId, client);
    const [activeStaff, pendingInvitations] = await Promise.all([
      client.profile.count({
        where: {
          organization_id: organizationId,
          is_deleted: false,
          is_active: true,
        },
      }),
      client.invitation.count({
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

  async assertOrganizationLimit(
    userId: string,
    client: Prisma.TransactionClient = this.prismaService.db,
  ): Promise<void> {
    const ownerRole = await client.role.findUnique({
      where: { code: 'OWNER' },
    });
    if (!ownerRole)
      throw new InternalServerErrorException('OWNER role not seeded');

    const ownedRows = await client.profile.findMany({
      where: {
        user_id: userId,
        is_deleted: false,
        is_active: true,
        roles: { some: { role_id: ownerRole.id } },
        organization: { is_deleted: false, status: 'ACTIVE' },
      },
      select: { organization_id: true },
    });
    const ownedOrganizationIds = ownedRows.map((r) => r.organization_id);
    const current = ownedOrganizationIds.length;

    // Cap = highest `max_organizations` among the active plans of orgs this
    // user already owns. A new owner with no orgs gets the free-trial allowance.
    let maxAllowed: number;
    if (ownedOrganizationIds.length > 0) {
      const subs = await client.subscription.findMany({
        where: {
          organization_id: { in: ownedOrganizationIds },
          is_deleted: false,
          status: { in: ACTIVE_STATUSES },
        },
        select: { subscription_plan: { select: { max_organizations: true } } },
      });
      maxAllowed = Math.max(
        ...subs.map((s) => s.subscription_plan.max_organizations),
        0,
      );
    } else {
      const freePlan = await client.subscriptionPlan.findUnique({
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

  private async getActivePlan(
    organizationId: string,
    client: Prisma.TransactionClient = this.prismaService.db,
  ) {
    const sub = await client.subscription.findFirst({
      where: { organization_id: organizationId, is_deleted: false },
      include: { subscription_plan: true },
      orderBy: { created_at: 'desc' }, // defensive; one sub per org by design
    });
    if (!sub) {
      // Invariant: every org gets a free-trial subscription at signup.
      throw new InternalServerErrorException(
        'Organization has no subscription',
      );
    }
    if (!ACTIVE_STATUSES.includes(sub.status)) {
      throw new ForbiddenException({
        code: ERROR_CODES.SUBSCRIPTION_EXPIRED,
        message: 'Subscription is not active. Renew or upgrade your plan.',
        details: { status: sub.status },
      });
    }
    return sub.subscription_plan;
  }
}
