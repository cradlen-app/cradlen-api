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
  subscription: { findFirst: jest.fn() },
  subscriptionPayment: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};
const mockPrisma = { db: mockDb } as unknown as PrismaService;
const mockAuth = {
  assertCanManageOrganization: jest.fn(),
  assertCanAccessOrganization: jest.fn(),
} as unknown as AuthorizationService;
const activateMock = jest.fn();
const mockSubscriptions = {
  activate: activateMock,
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
