import { ConflictException } from '@nestjs/common';
import { Prisma, SubscriptionPaymentStatus } from '@prisma/client';
import { SubscriptionPaymentsService } from './subscription-payments.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { StorageService } from '@infrastructure/storage/storage.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { SubscriptionsService } from '../subscriptions.service.js';
import { PaymentProviderFactory } from './providers/payment-provider.factory.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';

const mockDb = {
  subscriptionPlan: { findUnique: jest.fn() },
  planPrice: { findFirst: jest.fn() },
  addOn: { findFirst: jest.fn() },
  addOnPrice: { findFirst: jest.fn() },
  subscription: { findFirst: jest.fn() },
  subscriptionAddOn: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  subscriptionPayment: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  subscriptionPaymentItem: {
    findMany: jest.fn(),
  },
  $transaction: jest.fn(),
};
const mockPrisma = { db: mockDb } as unknown as PrismaService;
const mockAuth = {
  assertCanManageOrganization: jest.fn(),
  assertCanAccessOrganization: jest.fn(),
} as unknown as AuthorizationService;
const activateMock = jest.fn();
const assertUsageFitsPlanMock = jest.fn();
const mockSubscriptions = {
  activate: activateMock,
  assertUsageFitsPlan: assertUsageFitsPlanMock,
} as unknown as SubscriptionsService;
const mockInitiate = jest.fn();
const mockFactory = {
  get: jest.fn(() => ({ initiate: mockInitiate })),
} as unknown as PaymentProviderFactory;
const mockStorage = {} as unknown as StorageService;
const publishMock = jest.fn();
const mockEventBus = { publish: publishMock } as unknown as EventBus;

const ORG = 'org-1';
const USER: AuthContext = {
  userId: 'u1',
  profileId: 'p1',
  organizationId: ORG,
  roles: ['OWNER'],
  branchIds: [],
};

describe('SubscriptionPaymentsService', () => {
  let service: SubscriptionPaymentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SubscriptionPaymentsService(
      mockPrisma,
      mockAuth,
      mockSubscriptions,
      mockFactory,
      mockStorage,
      mockEventBus,
    );
    mockDb.$transaction.mockImplementation(
      (cb: (tx: typeof mockDb) => unknown) => cb(mockDb),
    );
  });

  describe('create', () => {
    it('snapshots the resolved price and initiates the provider', async () => {
      mockDb.subscriptionPlan.findUnique.mockResolvedValue({
        id: 'plan-1',
        plan: 'plus',
      });
      mockDb.planPrice.findFirst.mockResolvedValue({
        id: 'price-1',
        price: new Prisma.Decimal('12000'),
        currency: 'EGP',
      });
      mockDb.subscription.findFirst.mockResolvedValue({ id: 'sub-1' });
      mockDb.subscriptionPayment.create.mockImplementation((args) =>
        Promise.resolve({
          id: 'pay-1',
          created_at: new Date(),
          verified_at: null,
          rejection_reason: null,
          ...args.data,
        }),
      );
      mockInitiate.mockResolvedValue({
        settlement_mode: 'MANUAL_PROOF',
        requires_proof: true,
        instructions: { pay_to: 'x', reference: 'pay-1' },
      });

      const result = await service.create(
        ORG,
        { plan: 'plus', provider: 'INSTAPAY' as never },
        USER,
      );

      const createData =
        mockDb.subscriptionPayment.create.mock.calls[0][0].data;
      expect(createData.amount.toString()).toBe('12000');
      expect(createData.currency).toBe('EGP');
      expect(createData.status).toBe(SubscriptionPaymentStatus.PENDING);
      expect(createData.submitted_by_id).toBe('p1');
      expect(result.requires_proof).toBe(true);
      expect(result.payment.amount).toBe('12000');
      expect(mockInitiate).toHaveBeenCalled();
    });

    it('rejects purchasing the free trial plan', async () => {
      mockDb.subscriptionPlan.findUnique.mockResolvedValue({
        id: 'plan-free',
        plan: 'free_trial',
      });
      await expect(
        service.create(
          ORG,
          { plan: 'free_trial', provider: 'WALLET' as never },
          USER,
        ),
      ).rejects.toThrow();
    });

    it('prorates an add-on purchase and snapshots purpose/add_on_id/quantity', async () => {
      const now = Date.now();
      mockDb.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        status: 'ACTIVE',
        subscription_plan_id: 'plan-center',
        ends_at: new Date(now + 200 * 86_400_000), // ~200 days remaining
      });
      mockDb.addOn.findFirst.mockResolvedValue({
        id: 'addon-1',
        subscription_plan_id: 'plan-center',
      });
      mockDb.addOnPrice.findFirst.mockResolvedValue({
        price: new Prisma.Decimal('8000'),
        currency: 'EGP',
      });
      mockDb.subscriptionPayment.create.mockImplementation((args) =>
        Promise.resolve({
          id: 'pay-2',
          created_at: new Date(),
          verified_at: null,
          rejection_reason: null,
          ...args.data,
        }),
      );
      mockInitiate.mockResolvedValue({
        settlement_mode: 'MANUAL_PROOF',
        requires_proof: true,
        instructions: {},
      });

      await service.create(
        ORG,
        {
          plan: 'center',
          provider: 'INSTAPAY' as never,
          add_on_code: 'center_extra_branch',
          quantity: 2,
        },
        USER,
      );

      const createData =
        mockDb.subscriptionPayment.create.mock.calls[0][0].data;
      expect(createData.purpose).toBe('ADD_ON');
      expect(createData.add_on_id).toBe('addon-1');
      expect(createData.quantity).toBe(2);
      // prorated: 8000 × 2 × (~200/365) → between 0 and the full 16000
      const amount = Number(createData.amount.toString());
      expect(amount).toBeGreaterThan(0);
      expect(amount).toBeLessThan(16000);
    });

    it('caps the prorated amount at one yearly price when the term extends beyond a year', async () => {
      const now = Date.now();
      mockDb.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        status: 'ACTIVE',
        subscription_plan_id: 'plan-center',
        ends_at: new Date(now + 3 * 365 * 86_400_000), // stacked renewals: ~3 years remaining
      });
      mockDb.addOn.findFirst.mockResolvedValue({
        id: 'addon-1',
        subscription_plan_id: 'plan-center',
      });
      mockDb.addOnPrice.findFirst.mockResolvedValue({
        price: new Prisma.Decimal('8000'),
        currency: 'EGP',
      });
      mockDb.subscriptionPayment.create.mockImplementation((args) =>
        Promise.resolve({
          id: 'pay-3',
          created_at: new Date(),
          verified_at: null,
          rejection_reason: null,
          ...args.data,
        }),
      );
      mockInitiate.mockResolvedValue({
        settlement_mode: 'MANUAL_PROOF',
        requires_proof: true,
        instructions: {},
      });

      await service.create(
        ORG,
        {
          plan: 'center',
          provider: 'INSTAPAY' as never,
          add_on_code: 'center_extra_branch',
          quantity: 2,
        },
        USER,
      );

      const createData =
        mockDb.subscriptionPayment.create.mock.calls[0][0].data;
      expect(createData.amount.toString()).toBe('16000');
    });

    it('rejects an add-on purchase without an active paid subscription', async () => {
      mockDb.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        status: 'TRIAL',
        subscription_plan_id: 'plan-center',
        ends_at: null,
      });
      await expect(
        service.create(
          ORG,
          {
            plan: 'center',
            provider: 'INSTAPAY' as never,
            add_on_code: 'center_extra_branch',
          },
          USER,
        ),
      ).rejects.toThrow();
    });

    it('rejects an add-on that does not belong to the current plan', async () => {
      mockDb.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        status: 'ACTIVE',
        subscription_plan_id: 'plan-center',
        ends_at: new Date(Date.now() + 86_400_000),
      });
      mockDb.addOn.findFirst.mockResolvedValue({
        id: 'addon-x',
        subscription_plan_id: 'plan-network', // different tier
      });
      await expect(
        service.create(
          ORG,
          {
            plan: 'center',
            provider: 'INSTAPAY' as never,
            add_on_code: 'network_extra_branch',
          },
          USER,
        ),
      ).rejects.toThrow();
    });
  });

  describe('verifyPayment', () => {
    it('activates the subscription and marks the payment VERIFIED', async () => {
      mockDb.subscriptionPayment.findFirst.mockResolvedValue({
        id: 'pay-1',
        organization_id: ORG,
        subscription_plan_id: 'plan-1',
        billing_interval: 'YEARLY',
        status: SubscriptionPaymentStatus.AWAITING_VERIFICATION,
      });
      activateMock.mockResolvedValue({
        id: 'sub-1',
        ends_at: new Date('2027-01-01T00:00:00Z'),
      });
      mockDb.subscriptionPayment.update.mockImplementation((args) =>
        Promise.resolve({
          id: 'pay-1',
          organization_id: ORG,
          subscription_plan_id: 'plan-1',
          provider: 'INSTAPAY',
          billing_interval: 'YEARLY',
          amount: new Prisma.Decimal('12000'),
          currency: 'EGP',
          created_at: new Date(),
          verified_at: new Date(),
          rejection_reason: null,
          ...args.data,
        }),
      );

      const result = await service.verifyPayment('pay-1', 'admin-1');

      expect(activateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG,
          subscriptionPlanId: 'plan-1',
          billingInterval: 'YEARLY',
        }),
        mockDb,
      );
      expect(result.status).toBe(SubscriptionPaymentStatus.VERIFIED);
      expect(publishMock).toHaveBeenCalledWith(
        'subscription_payment.verified',
        expect.any(Object),
      );
      expect(publishMock).toHaveBeenCalledWith(
        'subscription.activated',
        expect.any(Object),
      );
    });

    it('grants the add-on (not activate) and publishes addon.granted', async () => {
      mockDb.subscriptionPayment.findFirst.mockResolvedValue({
        id: 'pay-2',
        organization_id: ORG,
        subscription_id: 'sub-1',
        subscription_plan_id: 'plan-center',
        purpose: 'ADD_ON',
        add_on_id: 'addon-1',
        quantity: 2,
        billing_interval: 'YEARLY',
        status: SubscriptionPaymentStatus.AWAITING_VERIFICATION,
      });
      mockDb.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        ends_at: new Date('2027-01-01T00:00:00Z'),
      });
      // Already owns 1 of this add-on (live grant → increment).
      mockDb.subscriptionAddOn.findUnique.mockResolvedValue({
        id: 'sao-1',
        status: 'ACTIVE',
        is_deleted: false,
        quantity: 1,
      });
      mockDb.subscriptionAddOn.update.mockResolvedValue({ id: 'sao-1' });
      mockDb.subscriptionPayment.update.mockImplementation((args) =>
        Promise.resolve({
          id: 'pay-2',
          organization_id: ORG,
          subscription_plan_id: 'plan-center',
          purpose: 'ADD_ON',
          add_on_id: 'addon-1',
          quantity: 2,
          provider: 'INSTAPAY',
          billing_interval: 'YEARLY',
          amount: new Prisma.Decimal('4000'),
          currency: 'EGP',
          created_at: new Date(),
          verified_at: new Date(),
          rejection_reason: null,
          ...args.data,
        }),
      );

      const result = await service.verifyPayment('pay-2', 'admin-1');

      expect(activateMock).not.toHaveBeenCalled();
      expect(mockDb.subscriptionAddOn.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sao-1' },
          data: expect.objectContaining({
            quantity: { increment: 2 },
            status: 'ACTIVE',
            ends_at: new Date('2027-01-01T00:00:00Z'),
          }),
        }),
      );
      expect(mockDb.subscriptionAddOn.create).not.toHaveBeenCalled();
      expect(result.status).toBe(SubscriptionPaymentStatus.VERIFIED);
      expect(publishMock).toHaveBeenCalledWith(
        'subscription.addon.granted',
        expect.objectContaining({ add_on_id: 'addon-1', quantity: 2 }),
      );
      expect(publishMock).not.toHaveBeenCalledWith(
        'subscription.activated',
        expect.any(Object),
      );
    });

    it('COMBINED: activates the plan AND grants each add-on, atomically', async () => {
      mockDb.subscriptionPayment.findFirst.mockResolvedValue({
        id: 'pay-3',
        organization_id: ORG,
        subscription_plan_id: 'plan-individual',
        purpose: 'COMBINED',
        billing_interval: 'YEARLY',
        status: SubscriptionPaymentStatus.AWAITING_VERIFICATION,
      });
      mockDb.subscriptionPaymentItem.findMany.mockResolvedValue([
        {
          kind: 'PLAN',
          subscription_plan_id: 'plan-individual',
          add_on_id: null,
          quantity: 1,
        },
        {
          kind: 'ADD_ON',
          subscription_plan_id: null,
          add_on_id: 'seat',
          quantity: 3,
        },
      ]);
      activateMock.mockResolvedValue({
        id: 'sub-1',
        ends_at: new Date('2027-01-01T00:00:00Z'),
      });
      // First purchase of this add-on → a new row is created.
      mockDb.subscriptionAddOn.findUnique.mockResolvedValue(null);
      mockDb.subscriptionAddOn.create.mockResolvedValue({ id: 'sao-1' });
      mockDb.subscriptionPayment.update.mockImplementation((args) =>
        Promise.resolve({
          id: 'pay-3',
          organization_id: ORG,
          subscription_plan_id: 'plan-individual',
          purpose: 'COMBINED',
          add_on_id: null,
          quantity: 1,
          provider: 'INSTAPAY',
          billing_interval: 'YEARLY',
          amount: new Prisma.Decimal('15500'),
          currency: 'EGP',
          created_at: new Date(),
          verified_at: new Date(),
          rejection_reason: null,
          ...args.data,
        }),
      );

      const result = await service.verifyPayment('pay-3', 'admin-1');

      expect(assertUsageFitsPlanMock).toHaveBeenCalledWith(
        ORG,
        'plan-individual',
        { cartAddOns: [{ addOnId: 'seat', quantity: 3 }] },
        mockDb,
      );
      expect(activateMock).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionPlanId: 'plan-individual' }),
        mockDb,
      );
      expect(mockDb.subscriptionAddOn.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscription_id: 'sub-1',
            add_on_id: 'seat',
            quantity: 3,
            status: 'ACTIVE',
            ends_at: new Date('2027-01-01T00:00:00Z'),
          }),
        }),
      );
      expect(result.status).toBe(SubscriptionPaymentStatus.VERIFIED);
      expect(publishMock).toHaveBeenCalledWith(
        'subscription.activated',
        expect.any(Object),
      );
      expect(publishMock).toHaveBeenCalledWith(
        'subscription.addon.granted',
        expect.objectContaining({ add_on_id: 'seat', quantity: 3 }),
      );
    });

    it('re-granting a previously cancelled add-on resets quantity instead of incrementing', async () => {
      // Plan round-trip: the row was CANCELLED when the org changed plans, so
      // its stale quantity must not be resurrected by an increment.
      mockDb.subscriptionPayment.findFirst.mockResolvedValue({
        id: 'pay-4',
        organization_id: ORG,
        subscription_id: 'sub-1',
        subscription_plan_id: 'plan-center',
        purpose: 'ADD_ON',
        add_on_id: 'addon-1',
        quantity: 1,
        billing_interval: 'YEARLY',
        status: SubscriptionPaymentStatus.AWAITING_VERIFICATION,
      });
      mockDb.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        ends_at: new Date('2027-01-01T00:00:00Z'),
      });
      mockDb.subscriptionAddOn.findUnique.mockResolvedValue({
        id: 'sao-1',
        status: 'CANCELLED',
        is_deleted: false,
        quantity: 2,
      });
      mockDb.subscriptionAddOn.update.mockResolvedValue({ id: 'sao-1' });
      mockDb.subscriptionPayment.update.mockImplementation((args) =>
        Promise.resolve({
          id: 'pay-4',
          organization_id: ORG,
          subscription_plan_id: 'plan-center',
          purpose: 'ADD_ON',
          add_on_id: 'addon-1',
          quantity: 1,
          provider: 'INSTAPAY',
          billing_interval: 'YEARLY',
          amount: new Prisma.Decimal('2000'),
          currency: 'EGP',
          created_at: new Date(),
          verified_at: new Date(),
          rejection_reason: null,
          ...args.data,
        }),
      );

      await service.verifyPayment('pay-4', 'admin-1');

      expect(mockDb.subscriptionAddOn.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sao-1' },
          data: expect.objectContaining({
            quantity: 1, // reset, not { increment: 1 } on the stale 2
            status: 'ACTIVE',
            starts_at: expect.any(Date),
            ends_at: new Date('2027-01-01T00:00:00Z'),
            is_deleted: false,
            deleted_at: null,
          }),
        }),
      );
      expect(mockDb.subscriptionAddOn.create).not.toHaveBeenCalled();
    });

    it('rejects verifying a payment that is not awaiting verification', async () => {
      mockDb.subscriptionPayment.findFirst.mockResolvedValue({
        id: 'pay-1',
        status: SubscriptionPaymentStatus.PENDING,
      });
      await expect(service.verifyPayment('pay-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(activateMock).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('rejects cancelling a verified payment', async () => {
      mockDb.subscriptionPayment.findFirst.mockResolvedValue({
        id: 'pay-1',
        organization_id: ORG,
        status: SubscriptionPaymentStatus.VERIFIED,
      });
      await expect(service.cancel(ORG, 'pay-1', USER)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
