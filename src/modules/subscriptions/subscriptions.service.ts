import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ERROR_CODES } from '../../common/constant/error-codes.js';
import { PrismaService } from '../../database/prisma.service.js';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prismaService: PrismaService) {}

  async assertBranchLimit(accountId: string): Promise<void> {
    const plan = await this.getActivePlan(accountId);
    const current = await this.prismaService.db.branch.count({
      where: { account_id: accountId, is_deleted: false },
    });
    if (current >= plan.max_branches) {
      throw new ForbiddenException({
        code: ERROR_CODES.SUBSCRIPTION_LIMIT_REACHED,
        message: `Branch limit reached (${plan.max_branches}). Upgrade your plan.`,
        details: { resource: 'branches', limit: plan.max_branches, current },
      });
    }
  }

  async assertStaffLimit(accountId: string): Promise<void> {
    const plan = await this.getActivePlan(accountId);
    const [activeStaff, pendingInvitations] = await Promise.all([
      this.prismaService.db.profile.count({
        where: { account_id: accountId, is_deleted: false, is_active: true },
      }),
      this.prismaService.db.invitation.count({
        where: { account_id: accountId, is_deleted: false, status: 'PENDING' },
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

  async assertAccountLimit(userId: string): Promise<void> {
    const ownerRole = await this.prismaService.db.role.findUnique({
      where: { name: 'OWNER' },
    });
    if (!ownerRole)
      throw new InternalServerErrorException('OWNER role not seeded');

    const ownedAccountIds = await this.prismaService.db.profile
      .findMany({
        where: {
          user_id: userId,
          is_deleted: false,
          is_active: true,
          roles: { some: { role_id: ownerRole.id } },
          account: { is_deleted: false, status: 'ACTIVE' },
        },
        select: { account_id: true },
      })
      .then((rows) => rows.map((r) => r.account_id));

    const current = ownedAccountIds.length;

    let maxAllowed: number;
    if (ownedAccountIds.length > 0) {
      const subs = await this.prismaService.db.subscription.findMany({
        where: { account_id: { in: ownedAccountIds }, is_deleted: false },
        select: { subscription_plan: { select: { max_accounts: true } } },
      });
      maxAllowed = Math.max(
        ...subs.map((s) => s.subscription_plan.max_accounts),
        0,
      );
    } else {
      const freePlan = await this.prismaService.db.subscriptionPlan.findUnique({
        where: { plan: 'free_trial' },
      });
      if (!freePlan)
        throw new InternalServerErrorException('Free trial plan not seeded');
      maxAllowed = freePlan.max_accounts;
    }

    if (current >= maxAllowed) {
      throw new ForbiddenException({
        code: ERROR_CODES.SUBSCRIPTION_LIMIT_REACHED,
        message: `Account limit reached (${maxAllowed}). Upgrade your plan.`,
        details: { resource: 'accounts', limit: maxAllowed, current },
      });
    }
  }

  private async getActivePlan(accountId: string) {
    const sub = await this.prismaService.db.subscription.findFirst({
      where: { account_id: accountId, is_deleted: false },
      include: { subscription_plan: true },
      orderBy: { created_at: 'desc' },
    });
    if (!sub)
      throw new NotFoundException('No active subscription found for account');
    return sub.subscription_plan;
  }
}
