import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  BillingInterval,
  Prisma,
  SubscriptionAddOnStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { ERROR_CODES } from '@common/constant/error-codes.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

const ACTIVE_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.TRIAL,
  SubscriptionStatus.ACTIVE,
];

/**
 * Anti-abuse cap on how many organizations one user may hold while those orgs
 * are still on the free-trial plan. Orgs converted to a paid plan don't count,
 * so genuine multi-tenant owners are unlimited. This replaces the old
 * per-plan `max_organizations` gate (that column is now informational only).
 */
export const MAX_TRIAL_ORGANIZATIONS_PER_USER = 3;

/**
 * SubscriptionPlan.plan value for the free-trial plan. Duplicated here (rather
 * than imported from `@core/org/organizations`) so subscriptions doesn't take a
 * dependency on the organizations module, which already depends on it.
 */
const FREE_TRIAL_PLAN = 'free_trial';

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

  /**
   * The org's current subscription with its plan and its ACTIVE, unexpired
   * add-ons, or throws 500 if missing (invariant). Unlike `getEffectiveLimits`,
   * this never throws on a lapsed subscription — the UI must render expired state.
   */
  async getCurrent(organizationId: string) {
    const sub = await this.prismaService.db.subscription.findFirst({
      where: { organization_id: organizationId, is_deleted: false },
      orderBy: { created_at: 'desc' },
      include: {
        subscription_plan: true,
        add_ons: {
          where: {
            is_deleted: false,
            status: 'ACTIVE',
            OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }],
          },
          include: { add_on: true },
          orderBy: { created_at: 'asc' },
        },
      },
    });
    if (!sub) {
      throw new InternalServerErrorException(
        'Organization has no subscription',
      );
    }
    // Add-ons are plan-scoped: hide rows belonging to another plan's catalog
    // (stale pre-cleanup data) so the response's add-on list and the enforced
    // limits can never diverge.
    sub.add_ons = sub.add_ons.filter(
      (owned) => owned.add_on.subscription_plan_id === sub.subscription_plan_id,
    );
    return sub;
  }

  /**
   * The add-ons purchasable on top of the org's current plan (active catalog
   * rows scoped to the current `subscription_plan_id`), with their full YEARLY
   * price. The actual charge at purchase time is prorated to the remaining term.
   */
  async listAvailableAddOns(organizationId: string) {
    const sub = await this.prismaService.db.subscription.findFirst({
      where: { organization_id: organizationId, is_deleted: false },
      orderBy: { created_at: 'desc' },
      select: { subscription_plan_id: true },
    });
    if (!sub) {
      throw new InternalServerErrorException(
        'Organization has no subscription',
      );
    }

    const addOns = await this.prismaService.db.addOn.findMany({
      where: {
        subscription_plan_id: sub.subscription_plan_id,
        is_active: true,
        is_deleted: false,
      },
      include: {
        prices: {
          where: {
            billing_interval: BillingInterval.YEARLY,
            is_active: true,
            is_deleted: false,
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    return addOns.map((addOn) => ({
      id: addOn.id,
      code: addOn.code,
      name: addOn.name,
      kind: addOn.kind,
      delta_branches: addOn.delta_branches,
      delta_users: addOn.delta_users,
      price: (addOn.prices[0]?.price ?? new Prisma.Decimal(0)).toString(),
      currency: addOn.prices[0]?.currency ?? 'EGP',
    }));
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
    if (sub.subscription_plan_id !== params.subscriptionPlanId) {
      // Add-ons are plan-scoped: an add-on from the outgoing plan's catalog
      // does not transfer to the new plan. Cancel it before the extend below
      // so it stops counting toward limits and drops out of the subscription
      // response.
      await client.subscriptionAddOn.updateMany({
        where: {
          subscription_id: sub.id,
          is_deleted: false,
          status: SubscriptionAddOnStatus.ACTIVE,
          add_on: { subscription_plan_id: { not: params.subscriptionPlanId } },
        },
        data: { status: SubscriptionAddOnStatus.CANCELLED, ends_at: now },
      });
    }
    // Co-terminus add-ons renew with the base plan: extend every surviving
    // active add-on to the new end date so they stay valid for the renewed term.
    await client.subscriptionAddOn.updateMany({
      where: {
        subscription_id: sub.id,
        is_deleted: false,
        status: SubscriptionAddOnStatus.ACTIVE,
      },
      data: { ends_at: endsAt },
    });
    this.bustStatusCache(params.organizationId);
    return updated;
  }

  /**
   * Current resource usage that counts against the plan caps:
   * - `staff` = active (non-deleted) profiles + PENDING invitations (a pending
   *   invite is a reserved seat).
   * - `branches` = non-deleted branches.
   * Shared by `assertStaffLimit` / `assertBranchLimit` (add-time `>=` gate) and
   * `assertUsageFitsPlan` (plan-change `>` gate).
   */
  private async countCurrentUsage(
    organizationId: string,
    client: Prisma.TransactionClient = this.prismaService.db,
  ): Promise<{ staff: number; branches: number }> {
    const [activeStaff, pendingInvitations, branches] = await Promise.all([
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
      client.branch.count({
        where: { organization_id: organizationId, is_deleted: false },
      }),
    ]);
    return { staff: activeStaff + pendingInvitations, branches };
  }

  async assertBranchLimit(
    organizationId: string,
    client: Prisma.TransactionClient = this.prismaService.db,
  ): Promise<void> {
    const limits = await this.getEffectiveLimits(organizationId, client);
    const { branches: current } = await this.countCurrentUsage(
      organizationId,
      client,
    );
    if (current >= limits.max_branches) {
      throw new ForbiddenException({
        code: ERROR_CODES.SUBSCRIPTION_LIMIT_REACHED,
        message: `Branch limit reached (${limits.max_branches}). Upgrade your plan or add a branch add-on.`,
        details: { resource: 'branches', limit: limits.max_branches, current },
      });
    }
  }

  async assertStaffLimit(
    organizationId: string,
    client: Prisma.TransactionClient = this.prismaService.db,
  ): Promise<void> {
    const limits = await this.getEffectiveLimits(organizationId, client);
    const { staff: current } = await this.countCurrentUsage(
      organizationId,
      client,
    );
    if (current >= limits.max_staff) {
      throw new ForbiddenException({
        code: ERROR_CODES.SUBSCRIPTION_LIMIT_REACHED,
        message: `Staff limit reached (${limits.max_staff}). Upgrade your plan or add a user add-on.`,
        details: { resource: 'staff', limit: limits.max_staff, current },
      });
    }
  }

  /**
   * A user may own any number of organizations, but only
   * `MAX_TRIAL_ORGANIZATIONS_PER_USER` of them may be on the free-trial plan at
   * once (anti-abuse: stops one account from farming unlimited free trials).
   * Orgs that have converted to a paid plan don't count, so genuine
   * multi-tenant owners can keep growing. Called before every org creation,
   * which always provisions a fresh free-trial subscription.
   */
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
        role_id: ownerRole.id,
        organization: { is_deleted: false, status: 'ACTIVE' },
      },
      select: { organization_id: true },
    });
    const ownedOrganizationIds = ownedRows.map((r) => r.organization_id);
    // First org is always allowed; nothing to count against the cap yet.
    if (ownedOrganizationIds.length === 0) return;

    // Only orgs still on the free-trial plan count against the cap; paid orgs
    // are unlimited.
    const trialOrganizationCount = await client.subscription.count({
      where: {
        organization_id: { in: ownedOrganizationIds },
        is_deleted: false,
        status: { in: ACTIVE_STATUSES },
        subscription_plan: { plan: FREE_TRIAL_PLAN },
      },
    });

    if (trialOrganizationCount >= MAX_TRIAL_ORGANIZATIONS_PER_USER) {
      throw new ForbiddenException({
        code: ERROR_CODES.SUBSCRIPTION_LIMIT_REACHED,
        message: `Free-trial organization limit reached (${MAX_TRIAL_ORGANIZATIONS_PER_USER}). Upgrade an existing organization to a paid plan before starting another trial.`,
        details: {
          resource: 'trial_organizations',
          limit: MAX_TRIAL_ORGANIZATIONS_PER_USER,
          current: trialOrganizationCount,
        },
      });
    }
  }

  /**
   * The org's effective resource caps = base plan limits + the sum of every
   * ACTIVE, unexpired add-on's deltas (× quantity). Throws SUBSCRIPTION_EXPIRED
   * if the subscription is not TRIAL/ACTIVE. The add-on date filter mirrors
   * `isOrgActive` so an expired add-on stops counting without a cron.
   */
  async getEffectiveLimits(
    organizationId: string,
    client: Prisma.TransactionClient = this.prismaService.db,
  ): Promise<{
    max_branches: number;
    max_staff: number;
    max_organizations: number;
  }> {
    const sub = await client.subscription.findFirst({
      where: { organization_id: organizationId, is_deleted: false },
      orderBy: { created_at: 'desc' }, // defensive; one sub per org by design
      include: {
        subscription_plan: true,
        add_ons: {
          where: {
            is_deleted: false,
            status: 'ACTIVE',
            OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }],
          },
          include: { add_on: true },
        },
      },
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

    let maxBranches = sub.subscription_plan.max_branches;
    let maxStaff = sub.subscription_plan.max_staff;
    for (const owned of sub.add_ons) {
      // Plan-scoped: skip stale rows from another plan's catalog (pre-cleanup
      // data from before add-ons were cancelled on plan change).
      if (owned.add_on.subscription_plan_id !== sub.subscription_plan_id) {
        continue;
      }
      maxBranches += owned.add_on.delta_branches * owned.quantity;
      maxStaff += owned.add_on.delta_users * owned.quantity;
    }
    return {
      max_branches: maxBranches,
      max_staff: maxStaff,
      max_organizations: sub.subscription_plan.max_organizations,
    };
  }

  /**
   * Effective caps the org *would* have on a TARGET plan = the target plan's base
   * limits + the org's currently-ACTIVE add-ons **belonging to the target plan's
   * catalog** (add-ons are plan-scoped and do not transfer across plan changes)
   * + any `cartAddOns` being purchased in the same checkout (combined
   * plan+seats). Used by `assertUsageFitsPlan` to decide whether a plan
   * change/purchase fits.
   */
  async getEffectiveLimitsForPlan(
    targetPlanId: string,
    organizationId: string,
    client: Prisma.TransactionClient = this.prismaService.db,
    cartAddOns: { addOnId: string; quantity: number }[] = [],
  ): Promise<{ max_branches: number; max_staff: number }> {
    const [plan, activeAddOns] = await Promise.all([
      client.subscriptionPlan.findUnique({ where: { id: targetPlanId } }),
      client.subscriptionAddOn.findMany({
        where: {
          subscription: { organization_id: organizationId, is_deleted: false },
          is_deleted: false,
          status: SubscriptionAddOnStatus.ACTIVE,
          add_on: { subscription_plan_id: targetPlanId },
          OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }],
        },
        include: { add_on: true },
      }),
    ]);
    if (!plan) {
      throw new InternalServerErrorException('Target plan not found');
    }

    let maxBranches = plan.max_branches;
    let maxStaff = plan.max_staff;
    for (const owned of activeAddOns) {
      maxBranches += owned.add_on.delta_branches * owned.quantity;
      maxStaff += owned.add_on.delta_users * owned.quantity;
    }
    if (cartAddOns.length > 0) {
      const cartRows = await client.addOn.findMany({
        where: { id: { in: cartAddOns.map((c) => c.addOnId) } },
      });
      const byId = new Map(cartRows.map((r) => [r.id, r]));
      for (const item of cartAddOns) {
        const addOn = byId.get(item.addOnId);
        if (!addOn) continue;
        maxBranches += addOn.delta_branches * item.quantity;
        maxStaff += addOn.delta_users * item.quantity;
      }
    }
    return { max_branches: maxBranches, max_staff: maxStaff };
  }

  /**
   * Guards a plan purchase/change: the org's current usage must fit the TARGET
   * plan's effective caps (base + active add-ons + any `cartAddOns` bought in the
   * same checkout). Unlike the add-time `>=` gate this uses strict `>` (exactly
   * filling the plan is allowed). Throws `SUBSCRIPTION_LIMIT_REACHED` with
   * `reason: 'PLAN_CHANGE_OVER_LIMIT'` and `suggested_add_ons` — the add-on set
   * (branch bundles + extra seats) the FE can buy together with the plan to keep
   * everything in one combined payment.
   */
  async assertUsageFitsPlan(
    organizationId: string,
    targetPlanId: string,
    opts: { cartAddOns?: { addOnId: string; quantity: number }[] } = {},
    client: Prisma.TransactionClient = this.prismaService.db,
  ): Promise<void> {
    const [limits, usage] = await Promise.all([
      this.getEffectiveLimitsForPlan(
        targetPlanId,
        organizationId,
        client,
        opts.cartAddOns ?? [],
      ),
      this.countCurrentUsage(organizationId, client),
    ]);

    const over: {
      resource: 'staff' | 'branches';
      limit: number;
      current: number;
      excess: number;
    }[] = [];
    if (usage.staff > limits.max_staff) {
      over.push({
        resource: 'staff',
        limit: limits.max_staff,
        current: usage.staff,
        excess: usage.staff - limits.max_staff,
      });
    }
    if (usage.branches > limits.max_branches) {
      over.push({
        resource: 'branches',
        limit: limits.max_branches,
        current: usage.branches,
        excess: usage.branches - limits.max_branches,
      });
    }
    if (over.length === 0) return;

    const staffOver = over.find((o) => o.resource === 'staff');
    const branchOver = over.find((o) => o.resource === 'branches');

    // Build the add-on set that would cover EVERY over-resource so the FE can
    // offer a one-click "reduce plan + buy add-ons to keep everything". Branch
    // bundles also bundle staff seats, so they're applied first and their
    // bundled users offset the remaining staff overage.
    const planAddOns = await client.addOn.findMany({
      where: {
        subscription_plan_id: targetPlanId,
        is_active: true,
        is_deleted: false,
      },
    });
    const bundle = planAddOns.find((a) => a.kind === 'BRANCH_BUNDLE');
    const extraUser = planAddOns.find((a) => a.kind === 'EXTRA_USER');

    const suggestedAddOns: {
      code: string;
      quantity: number;
      resource: 'branches' | 'staff';
    }[] = [];
    let bundledStaff = 0;
    if (branchOver && bundle && bundle.delta_branches > 0) {
      const bundleQty = Math.ceil(branchOver.excess / bundle.delta_branches);
      bundledStaff = bundleQty * bundle.delta_users;
      suggestedAddOns.push({
        code: bundle.code,
        quantity: bundleQty,
        resource: 'branches',
      });
    }
    if (staffOver && extraUser && extraUser.delta_users > 0) {
      const residual = Math.max(0, staffOver.excess - bundledStaff);
      if (residual > 0) {
        suggestedAddOns.push({
          code: extraUser.code,
          quantity: Math.ceil(residual / extraUser.delta_users),
          resource: 'staff',
        });
      }
    }

    const parts = over.map(
      (o) => `${o.resource}: ${o.current}/${o.limit} (over by ${o.excess})`,
    );
    throw new ForbiddenException({
      code: ERROR_CODES.SUBSCRIPTION_LIMIT_REACHED,
      message: `This plan does not fit your current usage — ${parts.join(
        '; ',
      )}. Free up resources, add add-ons, or choose a larger plan.`,
      details: {
        reason: 'PLAN_CHANGE_OVER_LIMIT',
        over,
        ...(suggestedAddOns.length > 0
          ? { suggested_add_ons: suggestedAddOns }
          : {}),
      },
    });
  }
}
