import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PaymentStatus, RefundStatus, Prisma } from '@prisma/client';
import { RefundsService } from './refunds.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { InvoiceBalanceService } from '../invoicing/invoice-balance.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';

const mockDb = {
  payment: { findFirst: jest.fn() },
  invoice: { findFirst: jest.fn() },
  refund: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};
const mockPrisma = { db: mockDb };
const mockAuth = {
  assertCanManageBranch: jest.fn(),
  assertCanAccessBranch: jest.fn(),
};
const mockBalance = { recompute: jest.fn() };
const mockEventBus = { publish: jest.fn() };

const ORG = 'org-1';
const USER: AuthContext = {
  userId: 'u1',
  profileId: 'p1',
  organizationId: ORG,
  roles: ['OWNER'],
  branchIds: ['br-1'],
};

describe('RefundsService', () => {
  let service: RefundsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        RefundsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuthorizationService, useValue: mockAuth },
        { provide: InvoiceBalanceService, useValue: mockBalance },
        { provide: EventBus, useValue: mockEventBus },
      ],
    }).compile();

    service = module.get(RefundsService);
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation(
      (fn: (tx: typeof mockDb) => unknown) => fn(mockDb),
    );
  });

  const completedPayment = (overrides = {}) => ({
    id: 'pay-1',
    status: PaymentStatus.COMPLETED,
    amount: new Prisma.Decimal('200.00'),
    invoice: { id: 'inv-1', branch_id: 'br-1' },
    refunds: [],
    ...overrides,
  });

  describe('create', () => {
    it('issues a refund, recomputes balance, and emits refund.issued', async () => {
      mockDb.payment.findFirst.mockResolvedValue(completedPayment());
      mockDb.refund.create.mockResolvedValue({
        id: 'ref-1',
        amount: new Prisma.Decimal('50.00'),
      });
      mockBalance.recompute.mockResolvedValue({});

      await service.create(
        ORG,
        { payment_id: 'pay-1', amount: 50, reason: 'overcharge' },
        USER,
      );

      expect(mockAuth.assertCanManageBranch).toHaveBeenCalledWith(
        'p1',
        ORG,
        'br-1',
      );
      expect(mockBalance.recompute).toHaveBeenCalledWith(mockDb, 'inv-1');
      expect(mockEventBus.publish.mock.calls[0][0]).toBe('refund.issued');
    });

    it('rejects a refund exceeding the refundable amount', async () => {
      mockDb.payment.findFirst.mockResolvedValue(
        completedPayment({
          refunds: [{ amount: new Prisma.Decimal('180.00') }],
        }),
      );

      await expect(
        service.create(
          ORG,
          { payment_id: 'pay-1', amount: 50, reason: 'too much' },
          USER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects refunding a non-completed payment', async () => {
      mockDb.payment.findFirst.mockResolvedValue(
        completedPayment({ status: PaymentStatus.VOID }),
      );

      await expect(
        service.create(
          ORG,
          { payment_id: 'pay-1', amount: 10, reason: 'nope' },
          USER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFound for an unknown payment', async () => {
      mockDb.payment.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          ORG,
          { payment_id: 'missing', amount: 10, reason: 'nope' },
          USER,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('voidRefund', () => {
    const completedRefund = (overrides = {}) => ({
      id: 'ref-1',
      status: RefundStatus.COMPLETED,
      payment_id: 'pay-1',
      payment: { invoice: { id: 'inv-1', branch_id: 'br-1' } },
      ...overrides,
    });

    it('voids a completed refund, recomputes balance, and emits refund.voided', async () => {
      mockDb.refund.findFirst.mockResolvedValue(completedRefund());
      mockDb.refund.update.mockResolvedValue({
        id: 'ref-1',
        status: RefundStatus.VOID,
      });
      mockBalance.recompute.mockResolvedValue({});

      await service.voidRefund(ORG, 'ref-1', USER);

      expect(mockAuth.assertCanManageBranch).toHaveBeenCalledWith(
        'p1',
        ORG,
        'br-1',
      );
      expect(mockDb.refund.update.mock.calls[0][0].data.status).toBe(
        RefundStatus.VOID,
      );
      expect(mockBalance.recompute).toHaveBeenCalledWith(mockDb, 'inv-1');
      expect(mockEventBus.publish.mock.calls[0][0]).toBe('refund.voided');
    });

    it('rejects voiding an already-void refund', async () => {
      mockDb.refund.findFirst.mockResolvedValue(
        completedRefund({ status: RefundStatus.VOID }),
      );
      await expect(service.voidRefund(ORG, 'ref-1', USER)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockDb.refund.update).not.toHaveBeenCalled();
    });

    it('throws NotFound for an unknown refund', async () => {
      mockDb.refund.findFirst.mockResolvedValue(null);
      await expect(service.voidRefund(ORG, 'missing', USER)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getRefund', () => {
    it('returns a single refund after a branch access check', async () => {
      mockDb.refund.findFirst.mockResolvedValue({
        id: 'ref-1',
        payment_id: 'pay-1',
        payment: { invoice: { branch_id: 'br-1' } },
      });

      const result = await service.getRefund(ORG, 'ref-1', USER);

      expect(mockAuth.assertCanAccessBranch).toHaveBeenCalledWith(
        'p1',
        ORG,
        'br-1',
      );
      expect(result.id).toBe('ref-1');
      // the joined payment relation is stripped from the response
      expect(result).not.toHaveProperty('payment');
    });

    it('404s a missing refund', async () => {
      mockDb.refund.findFirst.mockResolvedValue(null);
      await expect(service.getRefund(ORG, 'missing', USER)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listForInvoice', () => {
    it('lists refunds after a branch access check', async () => {
      mockDb.invoice.findFirst.mockResolvedValue({ branch_id: 'br-1' });
      mockDb.refund.findMany.mockResolvedValue([]);

      await service.listForInvoice(ORG, 'inv-1', USER);

      expect(mockAuth.assertCanAccessBranch).toHaveBeenCalledWith(
        'p1',
        ORG,
        'br-1',
      );
      expect(mockDb.refund.findMany).toHaveBeenCalled();
    });
  });
});
