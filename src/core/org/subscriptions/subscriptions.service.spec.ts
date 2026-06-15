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
