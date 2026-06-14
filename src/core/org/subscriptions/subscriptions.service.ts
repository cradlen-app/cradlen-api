import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { BillingInterval, Prisma, SubscriptionStatus } from '@prisma/client';
import { ERROR_CODES } from '@common/constant/error-codes.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

const ACTIVE_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.TRIAL,
  SubscriptionStatus.ACTIVE,
];

/** Adds one billing interval to a base date (returns a new Date). */
export function addBillingInterval(
  base: Date,
  interval: BillingInterval,
): Date {
  const next = new Date(base);
  if (interval === BillingInterval.YEARLY) {
    next.setFullYear(next.getFullYear() + 1);
  } else {
    next.setMonth(next.getMonth() + 1);
  }
  return next;
}

const STATUS_CACHE_TTL_MS = 30_000;

@Injectable()
export class SubscriptionsService {
  /** Short-TTL cache of per-org active status, to spare the guard a DB hit on every write. */
  private readonly statusCache = new Map<
    string,
    { active: boolean; expiresAt: number }
  >();

  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Whether the org may perform write actions: its subscription must be TRIAL or
   * ACTIVE *and* not past its end date (we check the date too, so the guard is
   * correct even before the expiry cron flips a lapsed row). Cached for ~30s.
   */
  async isOrgActive(organizationId: string): Promise<boolean> {
    const cached = this.statusCache.get(organizationId);
    if (cached && cached.expiresAt > Date.now()) return cached.active;

    const sub = await this.prismaService.db.subscription.findFirst({
      where: { organization_id: organizationId, is_deleted: false },
      orderBy: { created_at: 'desc' },
      select: { status: true, trial_ends_at: true, ends_at: true },
    });

    const now = Date.now();
    let active = false;
    if (sub) {
      if (sub.status === SubscriptionStatus.TRIAL) {
        active = !sub.trial_ends_at || sub.trial_ends_at.getTime() > now;
      } else if (sub.status === SubscriptionStatus.ACTIVE) {
        active = !sub.ends_at || sub.ends_at.getTime() > now;
      }
    }

    this.statusCache.set(organizationId, {
      active,
      expiresAt: now + STATUS_CACHE_TTL_MS,
    });
    return active;
  }

  /** Invalidates the cached active-status for an org (on activate / expiry). */
  bustStatusCache(organizationId: string): void {
    this.statusCache.delete(organizationId);
  }

  /** The org's current subscription with its plan, or throws 500 if missing (invariant). */
  async getCurrent(organizationId: string) {
    const sub = await this.prismaService.db.subscription.findFirst({
      where: { organization_id: organizationId, is_deleted: false },
      orderBy: { created_at: 'desc' },
      include: { subscription_plan: true },
    });
    if (!sub) {
      throw new InternalServerErrorException(
        'Organization has no subscription',
      );
    }
    return sub;
  }

  /**
   * Activates (or renews) the org's subscription onto `subscriptionPlanId` for
   * one `billingInterval`. Renewals stack: the new `ends_at` extends from the
   * current `ends_at` when still in the future, else from now. Transaction-
   * composable — pass the caller's tx client so payment + activation are atomic.
   */
  async activate(
    params: {
      organizationId: string;
      subscriptionPlanId: string;
      billingInterval: BillingInterval;
    },
    client: Prisma.TransactionClient = this.prismaService.db,
  ) {
    const sub = await client.subscription.findFirst({
      where: { organization_id: params.organizationId, is_deleted: false },
      orderBy: { created_at: 'desc' },
    });
    if (!sub) {
      throw new InternalServerErrorException(
        'Organization has no subscription',
      );
    }

    const now = new Date();
    const base = sub.ends_at && sub.ends_at > now ? sub.ends_at : now;
    const endsAt = addBillingInterval(base, params.billingInterval);

    const updated = await client.subscription.update({
      where: { id: sub.id },
      data: {
        subscription_plan_id: params.subscriptionPlanId,
        status: SubscriptionStatus.ACTIVE,
        ends_at: endsAt,
      },
    });
    this.bustStatusCache(params.organizationId);
    return updated;
  }

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
