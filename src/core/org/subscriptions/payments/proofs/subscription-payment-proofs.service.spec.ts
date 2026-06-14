import { BadRequestException, ConflictException } from '@nestjs/common';
import { SubscriptionPaymentStatus } from '@prisma/client';
import { SubscriptionPaymentProofsService } from './subscription-payment-proofs.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { StorageService } from '@infrastructure/storage/storage.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { SubscriptionPaymentsService } from '../subscription-payments.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';

const mockDb = {
  subscriptionPayment: { findFirst: jest.fn(), update: jest.fn() },
  subscriptionPaymentProof: {
    count: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};
const mockPrisma = { db: mockDb } as unknown as PrismaService;

const createPresignedUploadUrl = jest.fn();
const headObject = jest.fn();
const deleteObject = jest.fn();
const mockStorage = {
  assertAllowedContentType: jest.fn(),
  assertWithinSizeLimit: jest.fn(),
  extensionFor: jest.fn(() => 'png'),
  createPresignedUploadUrl,
  headObject,
  deleteObject,
} as unknown as StorageService;

const mockAuth = {
  assertCanManageOrganization: jest.fn(),
} as unknown as AuthorizationService;

const getMock = jest.fn();
const mockPayments = {
  get: getMock,
} as unknown as SubscriptionPaymentsService;

const publishMock = jest.fn();
const mockEventBus = { publish: publishMock } as unknown as EventBus;

const ORG = 'org-1';
const PAYMENT = 'pay-1';
const USER: AuthContext = {
  userId: 'u1',
  profileId: 'p1',
  organizationId: ORG,
  roles: ['OWNER'],
  branchIds: [],
};

describe('SubscriptionPaymentProofsService', () => {
  let service: SubscriptionPaymentProofsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SubscriptionPaymentProofsService(
      mockPrisma,
      mockStorage,
      mockAuth,
      mockPayments,
      mockEventBus,
    );
    mockDb.$transaction.mockImplementation(
      (cb: (tx: typeof mockDb) => unknown) => cb(mockDb),
    );
    getMock.mockResolvedValue({ id: PAYMENT });
  });

  describe('createUploadUrl', () => {
    it('issues a payment-scoped key and presigned PUT url', async () => {
      mockDb.subscriptionPayment.findFirst.mockResolvedValue({
        id: PAYMENT,
        status: SubscriptionPaymentStatus.PENDING,
      });
      createPresignedUploadUrl.mockResolvedValue({
        url: 'https://r2/put',
        expiresIn: 300,
      });

      const result = await service.createUploadUrl(
        ORG,
        PAYMENT,
        { content_type: 'image/png', size_bytes: 100 },
        USER,
      );

      expect(result.key).toMatch(
        new RegExp(`^subscription-payments/${PAYMENT}/proofs/.+\\.png$`),
      );
      expect(result.upload_url).toBe('https://r2/put');
    });

    it('rejects when the payment is no longer open', async () => {
      mockDb.subscriptionPayment.findFirst.mockResolvedValue({
        id: PAYMENT,
        status: SubscriptionPaymentStatus.VERIFIED,
      });
      await expect(
        service.createUploadUrl(
          ORG,
          PAYMENT,
          { content_type: 'image/png', size_bytes: 100 },
          USER,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('confirmProof', () => {
    it('rejects a key not scoped to this payment (cross-object guard)', async () => {
      mockDb.subscriptionPayment.findFirst.mockResolvedValue({
        id: PAYMENT,
        status: SubscriptionPaymentStatus.PENDING,
      });
      await expect(
        service.confirmProof(
          ORG,
          PAYMENT,
          { key: 'subscription-payments/other-payment/proofs/x.png' },
          USER,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(headObject).not.toHaveBeenCalled();
    });

    it('rejects when the uploaded object is not in storage', async () => {
      mockDb.subscriptionPayment.findFirst.mockResolvedValue({
        id: PAYMENT,
        status: SubscriptionPaymentStatus.PENDING,
      });
      headObject.mockResolvedValue(null);
      await expect(
        service.confirmProof(
          ORG,
          PAYMENT,
          { key: `subscription-payments/${PAYMENT}/proofs/x.png` },
          USER,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('appends the proof, flips PENDING -> AWAITING_VERIFICATION, and emits submitted', async () => {
      mockDb.subscriptionPayment.findFirst.mockResolvedValue({
        id: PAYMENT,
        organization_id: ORG,
        status: SubscriptionPaymentStatus.PENDING,
        amount: { toString: () => '12000' },
        currency: 'EGP',
      });
      headObject.mockResolvedValue({
        contentType: 'image/png',
        contentLength: 100,
      });
      mockDb.subscriptionPaymentProof.count.mockResolvedValue(0);

      await service.confirmProof(
        ORG,
        PAYMENT,
        { key: `subscription-payments/${PAYMENT}/proofs/x.png` },
        USER,
      );

      expect(mockDb.subscriptionPaymentProof.create).toHaveBeenCalled();
      expect(mockDb.subscriptionPayment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: SubscriptionPaymentStatus.AWAITING_VERIFICATION },
        }),
      );
      expect(publishMock).toHaveBeenCalledWith(
        'subscription_payment.submitted',
        expect.objectContaining({ payment_id: PAYMENT }),
      );
      expect(getMock).toHaveBeenCalledWith(ORG, PAYMENT, USER);
    });

    it('does not re-flip status or re-emit when already AWAITING_VERIFICATION', async () => {
      mockDb.subscriptionPayment.findFirst.mockResolvedValue({
        id: PAYMENT,
        organization_id: ORG,
        status: SubscriptionPaymentStatus.AWAITING_VERIFICATION,
        amount: { toString: () => '12000' },
        currency: 'EGP',
      });
      headObject.mockResolvedValue({
        contentType: 'image/png',
        contentLength: 100,
      });
      mockDb.subscriptionPaymentProof.count.mockResolvedValue(1);

      await service.confirmProof(
        ORG,
        PAYMENT,
        { key: `subscription-payments/${PAYMENT}/proofs/y.png` },
        USER,
      );

      expect(mockDb.subscriptionPayment.update).not.toHaveBeenCalled();
      expect(publishMock).not.toHaveBeenCalled();
    });
  });

  describe('removeProof', () => {
    it('soft-deletes an existing proof and best-effort removes the object', async () => {
      mockDb.subscriptionPayment.findFirst.mockResolvedValue({
        id: PAYMENT,
        status: SubscriptionPaymentStatus.AWAITING_VERIFICATION,
      });
      mockDb.subscriptionPaymentProof.findFirst.mockResolvedValue({
        id: 'proof-1',
        object_key: `subscription-payments/${PAYMENT}/proofs/x.png`,
      });
      deleteObject.mockResolvedValue(undefined);

      await service.removeProof(ORG, PAYMENT, 'proof-1', USER);

      expect(mockDb.subscriptionPaymentProof.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'proof-1' },
          data: expect.objectContaining({ is_deleted: true }),
        }),
      );
      expect(deleteObject).toHaveBeenCalled();
    });
  });
});
