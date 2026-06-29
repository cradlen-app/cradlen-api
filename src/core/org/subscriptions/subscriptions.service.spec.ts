import { BillingInterval, SubscriptionStatus } from '@prisma/client';
import {
  SubscriptionsService,
  addBillingInterval,
} from './subscriptions.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

const mockDb = {
  subscription: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  subscriptionAddOn: {
    updateMany: jest.fn(),
    findMany: jest.fn(),
  },
  subscriptionPlan: {
    findUnique: jest.fn(),
  },
  addOn: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  profile: {
    count: jest.fn(),
  },
  invitation: {
    count: jest.fn(),
  },
  branch: {
    count: jest.fn(),
  },
};
const mockPrisma = { db: mockDb } as unknown as PrismaService;

describe('addBillingInterval', () => {
  it('adds one year for YEARLY', () => {
    const base = new Date('2026-01-15T00:00:00Z');
    expect(addBillingInterval(base, BillingInterval.YEARLY)).toEqual(
      new Date('2027-01-15T00:00:00Z'),
    );
  });

  it('adds one month for MONTHLY', () => {
    const base = new Date('2026-01-15T00:00:00Z');
    expect(addBillingInterval(base, BillingInterval.MONTHLY)).toEqual(
      new Date('2026-02-15T00:00:00Z'),
    );
  });
});

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SubscriptionsService(mockPrisma);
  });

  describe('isOrgActive', () => {
    it('is true for a TRIAL subscription within its trial window', async () => {
      mockDb.subscription.findFirst.mockResolvedValue({
        status: SubscriptionStatus.TRIAL,
        trial_ends_at: new Date(Date.now() + 86_400_000),
        ends_at: null,
      });
      await expect(service.isOrgActive('org-1')).resolves.toBe(true);
    });

    it('is false for a TRIAL whose trial window has passed (before cron flips it)', async () => {
      mockDb.subscription.findFirst.mockResolvedValue({
        status: SubscriptionStatus.TRIAL,
        trial_ends_at: new Date(Date.now() - 1000),
        ends_at: null,
      });
      await expect(service.isOrgActive('org-1')).resolves.toBe(false);
    });

    it('is false for an EXPIRED subscription', async () => {
      mockDb.subscription.findFirst.mockResolvedValue({
        status: SubscriptionStatus.EXPIRED,
        trial_ends_at: null,
        ends_at: new Date(Date.now() - 1000),
      });
      await expect(service.isOrgActive('org-1')).resolves.toBe(false);
    });

    it('caches the result (one DB hit per TTL window) and busts on demand', async () => {
      mockDb.subscription.findFirst.mockResolvedValue({
        status: SubscriptionStatus.ACTIVE,
        trial_ends_at: null,
        ends_at: new Date(Date.now() + 86_400_000),
      });

      await service.isOrgActive('org-1');
      await service.isOrgActive('org-1');
      expect(mockDb.subscription.findFirst).toHaveBeenCalledTimes(1);

      service.bustStatusCache('org-1');
      await service.isOrgActive('org-1');
      expect(mockDb.subscription.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe('getEffectiveLimits', () => {
    it('sums active add-on deltas (× quantity) onto the base plan', async () => {
      mockDb.subscription.findFirst.mockResolvedValue({
        status: SubscriptionStatus.ACTIVE,
        subscription_plan: {
          max_branches: 1,
          max_staff: 10,
          max_organizations: 1,
        },
        add_ons: [
          // center extra-branch: +1 branch, +5 users
          { quantity: 1, add_on: { delta_branches: 1, delta_users: 5 } },
          // 3 extra user seats
          { quantity: 3, add_on: { delta_branches: 0, delta_users: 1 } },
        ],
      });

      await expect(service.getEffectiveLimits('org-1')).resolves.toEqual({
        max_branches: 2,
        max_staff: 18,
        max_organizations: 1,
      });
    });

    it('returns the bare plan limits when there are no add-ons', async () => {
      mockDb.subscription.findFirst.mockResolvedValue({
        status: SubscriptionStatus.TRIAL,
        subscription_plan: {
          max_branches: 1,
          max_staff: 5,
          max_organizations: 1,
        },
        add_ons: [],
      });

      await expect(service.getEffectiveLimits('org-1')).resolves.toEqual({
        max_branches: 1,
        max_staff: 5,
        max_organizations: 1,
      });
    });

    it('throws SUBSCRIPTION_EXPIRED when the subscription is not active', async () => {
      mockDb.subscription.findFirst.mockResolvedValue({
        status: SubscriptionStatus.EXPIRED,
        subscription_plan: {
          max_branches: 1,
          max_staff: 5,
          max_organizations: 1,
        },
        add_ons: [],
      });

      await expect(service.getEffectiveLimits('org-1')).rejects.toThrow();
    });
  });

  describe('assertUsageFitsPlan', () => {
    function mockUsage(staff: number, branches = 1) {
      // countCurrentUsage = active profiles + PENDING invitations, and branches.
      mockDb.profile.count.mockResolvedValue(staff);
      mockDb.invitation.count.mockResolvedValue(0);
      mockDb.branch.count.mockResolvedValue(branches);
    }

    // Target-plan add-on catalog used to build suggestions.
    const INDIVIDUAL_ADD_ONS = [
      {
        code: 'individual_extra_branch',
        kind: 'BRANCH_BUNDLE',
        delta_branches: 1,
        delta_users: 2,
      },
      {
        code: 'individual_extra_user',
        kind: 'EXTRA_USER',
        delta_branches: 0,
        delta_users: 1,
      },
    ];

    it('rejects a staff-only over-limit downgrade and suggests extra seats', async () => {
      // Target Individual (max_staff 2), org has 5 active staff, 1 branch.
      mockDb.subscriptionPlan.findUnique.mockResolvedValue({
        max_branches: 1,
        max_staff: 2,
      });
      mockDb.subscriptionAddOn.findMany.mockResolvedValue([]);
      mockDb.addOn.findMany.mockResolvedValue(INDIVIDUAL_ADD_ONS);
      mockUsage(5, 1);

      await expect(
        service.assertUsageFitsPlan('org-1', 'plan-individual'),
      ).rejects.toMatchObject({
        response: {
          code: 'SUBSCRIPTION_LIMIT_REACHED',
          details: {
            reason: 'PLAN_CHANGE_OVER_LIMIT',
            over: [{ resource: 'staff', limit: 2, current: 5, excess: 3 }],
            suggested_add_ons: [
              {
                code: 'individual_extra_user',
                quantity: 3,
                resource: 'staff',
              },
            ],
          },
        },
      });
    });

    it('suggests branch bundles for a branch-only overage (no seat line)', async () => {
      // Network-like org: 3 branches, 2 staff → Individual (1 branch / 2 staff).
      mockDb.subscriptionPlan.findUnique.mockResolvedValue({
        max_branches: 1,
        max_staff: 2,
      });
      mockDb.subscriptionAddOn.findMany.mockResolvedValue([]);
      mockDb.addOn.findMany.mockResolvedValue(INDIVIDUAL_ADD_ONS);
      mockUsage(2, 3);

      await expect(
        service.assertUsageFitsPlan('org-1', 'plan-individual'),
      ).rejects.toMatchObject({
        response: {
          details: {
            over: [{ resource: 'branches', limit: 1, current: 3, excess: 2 }],
            // 2 excess branches → 2 bundles; staff fits (bundled users cover it).
            suggested_add_ons: [
              {
                code: 'individual_extra_branch',
                quantity: 2,
                resource: 'branches',
              },
            ],
          },
        },
      });
    });

    it('suggests bundles + residual seats for a branch+staff overage', async () => {
      // 3 branches, 10 staff → Individual. 2 bundles (+1 branch, +2 users each)
      // cover branches and 4 of the 8 excess staff; 4 extra seats cover the rest.
      mockDb.subscriptionPlan.findUnique.mockResolvedValue({
        max_branches: 1,
        max_staff: 2,
      });
      mockDb.subscriptionAddOn.findMany.mockResolvedValue([]);
      mockDb.addOn.findMany.mockResolvedValue(INDIVIDUAL_ADD_ONS);
      mockUsage(10, 3);

      await expect(
        service.assertUsageFitsPlan('org-1', 'plan-individual'),
      ).rejects.toMatchObject({
        response: {
          details: {
            suggested_add_ons: [
              {
                code: 'individual_extra_branch',
                quantity: 2,
                resource: 'branches',
              },
              {
                code: 'individual_extra_user',
                quantity: 4,
                resource: 'staff',
              },
            ],
          },
        },
      });
    });

    it('allows a purchase that exactly fits the plan', async () => {
      mockDb.subscriptionPlan.findUnique.mockResolvedValue({
        max_branches: 1,
        max_staff: 2,
      });
      mockDb.subscriptionAddOn.findMany.mockResolvedValue([]);
      mockUsage(2);

      await expect(
        service.assertUsageFitsPlan('org-1', 'plan-individual'),
      ).resolves.toBeUndefined();
    });

    it('allows an over-base downgrade when the cart adds enough seats', async () => {
      // Individual base 2 + 3 cart seats (delta_users 1 each) = 5 ≥ 5 staff.
      mockDb.subscriptionPlan.findUnique.mockResolvedValue({
        max_branches: 1,
        max_staff: 2,
      });
      mockDb.subscriptionAddOn.findMany.mockResolvedValue([]);
      mockDb.addOn.findMany.mockResolvedValue([
        { id: 'addon-seat', delta_branches: 0, delta_users: 1 },
      ]);
      mockUsage(5);

      await expect(
        service.assertUsageFitsPlan('org-1', 'plan-individual', {
          cartAddOns: [{ addOnId: 'addon-seat', quantity: 3 }],
        }),
      ).resolves.toBeUndefined();
    });

    it('still rejects when the cart adds too few seats', async () => {
      mockDb.subscriptionPlan.findUnique.mockResolvedValue({
        max_branches: 1,
        max_staff: 2,
      });
      mockDb.subscriptionAddOn.findMany.mockResolvedValue([]);
      mockDb.addOn.findMany.mockResolvedValue([
        { id: 'addon-seat', delta_branches: 0, delta_users: 1 },
      ]);
      mockDb.addOn.findFirst.mockResolvedValue({
        code: 'individual_extra_user',
      });
      mockUsage(5); // base 2 + 2 cart seats = 4 < 5

      await expect(
        service.assertUsageFitsPlan('org-1', 'plan-individual', {
          cartAddOns: [{ addOnId: 'addon-seat', quantity: 2 }],
        }),
      ).rejects.toMatchObject({
        response: { code: 'SUBSCRIPTION_LIMIT_REACHED' },
      });
    });
  });

  describe('activate', () => {
    it('extends ends_at from now when no future end date (lapsed)', async () => {
      const now = Date.now();
      mockDb.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        ends_at: new Date(now - 86_400_000),
      });
      mockDb.subscription.update.mockImplementation((args) =>
        Promise.resolve({ id: 'sub-1', ...args.data }),
      );

      await service.activate({
        organizationId: 'org-1',
        subscriptionPlanId: 'plan-1',
        billingInterval: BillingInterval.YEARLY,
      });

      const data = mockDb.subscription.update.mock.calls[0][0].data;
      expect(data.status).toBe(SubscriptionStatus.ACTIVE);
      expect(data.subscription_plan_id).toBe('plan-1');
      // ~1 year from now (not from the past end date)
      const endsAt = (data.ends_at as Date).getTime();
      expect(endsAt).toBeGreaterThan(now);
    });

    it('stacks ends_at onto a still-future end date (renewal)', async () => {
      const future = new Date('2027-01-01T00:00:00Z');
      mockDb.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        ends_at: future,
      });
      mockDb.subscription.update.mockImplementation((args) =>
        Promise.resolve({ id: 'sub-1', ...args.data }),
      );

      await service.activate({
        organizationId: 'org-1',
        subscriptionPlanId: 'plan-1',
        billingInterval: BillingInterval.YEARLY,
      });

      const data = mockDb.subscription.update.mock.calls[0][0].data;
      expect(data.ends_at).toEqual(new Date('2028-01-01T00:00:00Z'));
    });

    it('cascades the new ends_at to active add-ons (co-terminus renewal)', async () => {
      const future = new Date('2027-01-01T00:00:00Z');
      mockDb.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        ends_at: future,
      });
      mockDb.subscription.update.mockImplementation((args) =>
        Promise.resolve({ id: 'sub-1', ...args.data }),
      );

      await service.activate({
        organizationId: 'org-1',
        subscriptionPlanId: 'plan-1',
        billingInterval: BillingInterval.YEARLY,
      });

      expect(mockDb.subscriptionAddOn.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            subscription_id: 'sub-1',
            status: 'ACTIVE',
          }),
          data: { ends_at: new Date('2028-01-01T00:00:00Z') },
        }),
      );
    });
  });
});
