import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PaymentsService } from './payments.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { FinancialAccessService } from '../shared/access/financial-access.service.js';
import { InvoiceBalanceService } from '../invoicing/invoice-balance.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';

const mockDb = {
  invoice: { findFirst: jest.fn() },
  payment: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  cashSession: { findFirst: jest.fn() },
  $transaction: jest.fn(),
};
const mockPrisma = { db: mockDb };
const mockAuth = {
  assertCanAccessBranch: jest.fn(),
  assertCanManageBranch: jest.fn(),
};
const mockAccess = { assertIsReceptionistOrOwner: jest.fn() };
const mockBalance = { recompute: jest.fn() };
const mockEventBus = { publish: jest.fn() };

const ORG = 'org-1';
const INVOICE = 'inv-1';
const USER: AuthContext = {
  userId: 'u1',
  profileId: 'p1',
  organizationId: ORG,
  roles: ['OWNER'],
  branchIds: ['br-1'],
};

describe('PaymentsService', () => {
  let service: PaymentsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuthorizationService, useValue: mockAuth },
        { provide: FinancialAccessService, useValue: mockAccess },
        { provide: InvoiceBalanceService, useValue: mockBalance },
        { provide: EventBus, useValue: mockEventBus },
      ],
    }).compile();

    service = module.get(PaymentsService);
    jest.clearAllMocks();
    // Default: the cashier holds an open drawer at the invoice's branch.
    mockDb.cashSession.findFirst.mockResolvedValue({ id: 'sess-1' });
    mockDb.$transaction.mockImplementation(
      (fn: (tx: typeof mockDb) => unknown) => fn(mockDb),
    );
  });

  describe('recordPayment', () => {
    it('records a payment, recomputes balance, and emits payment.recorded', async () => {
      mockDb.invoice.findFirst.mockResolvedValue({
        id: INVOICE,
        status: InvoiceStatus.ISSUED,
        currency: 'EGP',
        branch_id: 'br-1',
        patient_id: 'pat-1',
        total_amount: new Prisma.Decimal('200.00'),
        paid_amount: new Prisma.Decimal('0.00'),
      });
      mockDb.payment.create.mockResolvedValue({
        id: 'pay-1',
        amount: new Prisma.Decimal('100.00'),
        payment_method: PaymentMethod.CASH,
      });
      mockBalance.recompute.mockResolvedValue({
        status: InvoiceStatus.PARTIALLY_PAID,
        total_amount: new Prisma.Decimal('200.00'),
        paid_amount: new Prisma.Decimal('100.00'),
      });

      const result = await service.recordPayment(
        ORG,
        INVOICE,
        { amount: 100, payment_method: PaymentMethod.CASH },
        USER,
      );

      expect(mockAccess.assertIsReceptionistOrOwner).toHaveBeenCalledWith(
        USER,
        ORG,
      );
      expect(mockBalance.recompute).toHaveBeenCalledWith(mockDb, INVOICE);
      expect(mockEventBus.publish.mock.calls[0][0]).toBe('payment.recorded');
      // Returns both the payment row (receipt) and the recomputed invoice.
      expect(result.payment.id).toBe('pay-1');
      expect(result.invoice.status).toBe(InvoiceStatus.PARTIALLY_PAID);
    });

    it('attributes a cash payment to the cashier’s open session', async () => {
      mockDb.invoice.findFirst.mockResolvedValue({
        id: INVOICE,
        status: InvoiceStatus.ISSUED,
        currency: 'EGP',
        branch_id: 'br-1',
        patient_id: 'pat-1',
        total_amount: new Prisma.Decimal('200.00'),
        paid_amount: new Prisma.Decimal('0.00'),
      });
      mockDb.payment.create.mockResolvedValue({
        id: 'pay-1',
        amount: new Prisma.Decimal('100.00'),
        payment_method: PaymentMethod.CASH,
      });
      mockBalance.recompute.mockResolvedValue({
        status: InvoiceStatus.PARTIALLY_PAID,
        total_amount: new Prisma.Decimal('200.00'),
        paid_amount: new Prisma.Decimal('100.00'),
      });

      await service.recordPayment(
        ORG,
        INVOICE,
        { amount: 100, payment_method: PaymentMethod.CASH },
        USER,
      );

      expect(mockDb.payment.create.mock.calls[0][0].data.cash_session_id).toBe(
        'sess-1',
      );
    });

    it('does not attribute a card payment to the drawer session', async () => {
      mockDb.invoice.findFirst.mockResolvedValue({
        id: INVOICE,
        status: InvoiceStatus.ISSUED,
        currency: 'EGP',
        branch_id: 'br-1',
        patient_id: 'pat-1',
        total_amount: new Prisma.Decimal('200.00'),
        paid_amount: new Prisma.Decimal('0.00'),
      });
      mockDb.payment.create.mockResolvedValue({
        id: 'pay-1',
        amount: new Prisma.Decimal('100.00'),
        payment_method: PaymentMethod.CARD,
      });
      mockBalance.recompute.mockResolvedValue({
        status: InvoiceStatus.PARTIALLY_PAID,
        total_amount: new Prisma.Decimal('200.00'),
        paid_amount: new Prisma.Decimal('100.00'),
      });

      await service.recordPayment(
        ORG,
        INVOICE,
        { amount: 100, payment_method: PaymentMethod.CARD },
        USER,
      );

      expect(
        mockDb.payment.create.mock.calls[0][0].data.cash_session_id,
      ).toBeNull();
    });

    it('rejects a payment when the cashier has no open cash session', async () => {
      mockDb.invoice.findFirst.mockResolvedValue({
        id: INVOICE,
        status: InvoiceStatus.ISSUED,
        currency: 'EGP',
        branch_id: 'br-1',
        patient_id: 'pat-1',
        total_amount: new Prisma.Decimal('200.00'),
        paid_amount: new Prisma.Decimal('0.00'),
      });
      mockDb.cashSession.findFirst.mockResolvedValue(null);

      await expect(
        service.recordPayment(
          ORG,
          INVOICE,
          { amount: 100, payment_method: PaymentMethod.CARD },
          USER,
        ),
      ).rejects.toThrow('Open a cash session at this branch');
      expect(mockDb.payment.create).not.toHaveBeenCalled();
    });

    it('emits invoice.paid when the invoice becomes fully paid', async () => {
      mockDb.invoice.findFirst.mockResolvedValue({
        id: INVOICE,
        status: InvoiceStatus.ISSUED,
        currency: 'EGP',
        branch_id: 'br-1',
        patient_id: 'pat-1',
        total_amount: new Prisma.Decimal('200.00'),
        paid_amount: new Prisma.Decimal('0.00'),
      });
      mockDb.payment.create.mockResolvedValue({
        id: 'pay-1',
        amount: new Prisma.Decimal('200.00'),
        payment_method: PaymentMethod.CASH,
      });
      mockBalance.recompute.mockResolvedValue({
        status: InvoiceStatus.PAID,
        total_amount: new Prisma.Decimal('200.00'),
        paid_amount: new Prisma.Decimal('200.00'),
      });

      await service.recordPayment(
        ORG,
        INVOICE,
        { amount: 200, payment_method: PaymentMethod.CASH },
        USER,
      );

      const eventNames = mockEventBus.publish.mock.calls.map((c) => c[0]);
      expect(eventNames).toContain('invoice.paid');
    });

    it('rejects a payment that exceeds the outstanding balance', async () => {
      mockDb.invoice.findFirst.mockResolvedValue({
        id: INVOICE,
        status: InvoiceStatus.PARTIALLY_PAID,
        currency: 'EGP',
        branch_id: 'br-1',
        patient_id: 'pat-1',
        total_amount: new Prisma.Decimal('200.00'),
        paid_amount: new Prisma.Decimal('150.00'),
      });

      await expect(
        service.recordPayment(
          ORG,
          INVOICE,
          { amount: 100, payment_method: PaymentMethod.CASH },
          USER,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockDb.payment.create).not.toHaveBeenCalled();
    });

    it('allows a partial payment up to the outstanding balance', async () => {
      mockDb.invoice.findFirst.mockResolvedValue({
        id: INVOICE,
        status: InvoiceStatus.PARTIALLY_PAID,
        currency: 'EGP',
        branch_id: 'br-1',
        patient_id: 'pat-1',
        total_amount: new Prisma.Decimal('200.00'),
        paid_amount: new Prisma.Decimal('150.00'),
      });
      mockDb.payment.create.mockResolvedValue({
        id: 'pay-2',
        amount: new Prisma.Decimal('50.00'),
        payment_method: PaymentMethod.CASH,
      });
      mockBalance.recompute.mockResolvedValue({
        status: InvoiceStatus.PAID,
        total_amount: new Prisma.Decimal('200.00'),
        paid_amount: new Prisma.Decimal('200.00'),
      });

      await service.recordPayment(
        ORG,
        INVOICE,
        { amount: 50, payment_method: PaymentMethod.CASH },
        USER,
      );

      expect(mockDb.payment.create).toHaveBeenCalled();
    });

    it('rejects payment on a DRAFT invoice', async () => {
      mockDb.invoice.findFirst.mockResolvedValue({
        id: INVOICE,
        status: InvoiceStatus.DRAFT,
        currency: 'EGP',
        branch_id: 'br-1',
        patient_id: 'pat-1',
      });

      await expect(
        service.recordPayment(
          ORG,
          INVOICE,
          { amount: 50, payment_method: PaymentMethod.CASH },
          USER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a payment on a cancelled (VOID) invoice', async () => {
      mockDb.invoice.findFirst.mockResolvedValue({
        id: INVOICE,
        status: InvoiceStatus.VOID,
        currency: 'EGP',
        branch_id: 'br-1',
        patient_id: 'pat-1',
        total_amount: new Prisma.Decimal('200.00'),
        paid_amount: new Prisma.Decimal('0.00'),
      });

      await expect(
        service.recordPayment(
          ORG,
          INVOICE,
          { amount: 50, payment_method: PaymentMethod.CASH },
          USER,
        ),
      ).rejects.toThrow(
        'Cannot record a payment on a cancelled (void) invoice',
      );
      expect(mockDb.payment.create).not.toHaveBeenCalled();
    });

    it('rejects a payment on an already-paid invoice', async () => {
      mockDb.invoice.findFirst.mockResolvedValue({
        id: INVOICE,
        status: InvoiceStatus.PAID,
        currency: 'EGP',
        branch_id: 'br-1',
        patient_id: 'pat-1',
        total_amount: new Prisma.Decimal('200.00'),
        paid_amount: new Prisma.Decimal('200.00'),
      });

      await expect(
        service.recordPayment(
          ORG,
          INVOICE,
          { amount: 50, payment_method: PaymentMethod.CASH },
          USER,
        ),
      ).rejects.toThrow('Invoice is already fully paid');
    });
  });

  describe('getPayment', () => {
    it('returns a single payment', async () => {
      mockDb.invoice.findFirst.mockResolvedValue({
        id: INVOICE,
        branch_id: 'br-1',
      });
      mockDb.payment.findFirst.mockResolvedValue({ id: 'pay-1' });

      const result = await service.getPayment(ORG, INVOICE, 'pay-1', USER);
      expect(result.id).toBe('pay-1');
      expect(mockAuth.assertCanAccessBranch).toHaveBeenCalledWith(
        'p1',
        ORG,
        'br-1',
      );
    });

    it('404s a missing payment', async () => {
      mockDb.invoice.findFirst.mockResolvedValue({
        id: INVOICE,
        branch_id: 'br-1',
      });
      mockDb.payment.findFirst.mockResolvedValue(null);

      await expect(
        service.getPayment(ORG, INVOICE, 'missing', USER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('voidPayment', () => {
    it('voids a completed payment and recomputes balance', async () => {
      mockDb.invoice.findFirst.mockResolvedValue({
        id: INVOICE,
        status: InvoiceStatus.PARTIALLY_PAID,
        currency: 'EGP',
        branch_id: 'br-1',
        patient_id: 'pat-1',
      });
      mockDb.payment.findFirst.mockResolvedValue({
        id: 'pay-1',
        status: PaymentStatus.COMPLETED,
      });
      mockBalance.recompute.mockResolvedValue({ status: InvoiceStatus.ISSUED });

      await service.voidPayment(ORG, INVOICE, 'pay-1', USER);

      expect(mockAuth.assertCanManageBranch).toHaveBeenCalledWith(
        'p1',
        ORG,
        'br-1',
      );
      expect(mockDb.payment.update.mock.calls[0][0].data.status).toBe(
        PaymentStatus.VOID,
      );
      expect(mockEventBus.publish.mock.calls[0][0]).toBe('payment.voided');
    });

    it('rejects voiding an already-void payment', async () => {
      mockDb.invoice.findFirst.mockResolvedValue({
        id: INVOICE,
        status: InvoiceStatus.ISSUED,
        currency: 'EGP',
        branch_id: 'br-1',
        patient_id: 'pat-1',
      });
      mockDb.payment.findFirst.mockResolvedValue({
        id: 'pay-1',
        status: PaymentStatus.VOID,
      });

      await expect(
        service.voidPayment(ORG, INVOICE, 'pay-1', USER),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
