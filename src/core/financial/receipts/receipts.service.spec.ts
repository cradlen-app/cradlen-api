import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PaymentMethod, ReceiptStatus, Prisma } from '@prisma/client';
import { ReceiptsService } from './receipts.service.js';
import { ReceiptNumberService } from './receipt-number.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import type { PaymentRecordedEvent } from '../shared/events/financial-events.js';

const d = (n: string) => new Prisma.Decimal(n);

const mockDb = {
  receipt: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  invoice: { findUniqueOrThrow: jest.fn(), findFirst: jest.fn() },
};
const mockPrisma = { db: mockDb };
const mockAuth = { assertCanAccessBranch: jest.fn() };
const mockNumber = { generate: jest.fn() };
const mockEventBus = { publish: jest.fn() };

const ORG = 'org-1';
const USER: AuthContext = {
  userId: 'u1',
  profileId: 'p1',
  organizationId: ORG,
  roles: ['OWNER'],
  branchIds: ['br-1'],
};

const recordedEvent: PaymentRecordedEvent = {
  payment_id: 'pay-1',
  invoice_id: 'inv-1',
  organization_id: ORG,
  branch_id: 'br-1',
  amount: d('80.00'),
  payment_method: PaymentMethod.CASH,
  cash_session_id: null,
  recorded_by_id: 'p1',
};

describe('ReceiptsService', () => {
  let service: ReceiptsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ReceiptsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuthorizationService, useValue: mockAuth },
        { provide: ReceiptNumberService, useValue: mockNumber },
        { provide: EventBus, useValue: mockEventBus },
      ],
    }).compile();

    service = module.get(ReceiptsService);
    jest.clearAllMocks();
  });

  describe('issueForPayment', () => {
    it('creates a numbered receipt with balance_after from the invoice', async () => {
      mockDb.receipt.findUnique.mockResolvedValue(null);
      mockDb.invoice.findUniqueOrThrow.mockResolvedValue({
        patient_id: 'pat-1',
        currency: 'EGP',
        balance_due: d('120.00'),
      });
      mockNumber.generate.mockResolvedValue('RCP-2026-00001');
      mockDb.receipt.create.mockImplementation(({ data }) => ({
        id: 'rcp-1',
        ...data,
      }));

      await service.issueForPayment(recordedEvent);

      const data = mockDb.receipt.create.mock.calls[0][0].data;
      expect(data.receipt_number).toBe('RCP-2026-00001');
      expect(data.balance_after.toFixed(2)).toBe('120.00');
      expect(data.amount.toFixed(2)).toBe('80.00');
      expect(data.issued_by_id).toBe('p1');
      expect(mockEventBus.publish.mock.calls[0][0]).toBe('receipt.issued');
    });

    it('is idempotent — skips when a receipt already exists for the payment', async () => {
      mockDb.receipt.findUnique.mockResolvedValue({ id: 'rcp-1' });

      await service.issueForPayment(recordedEvent);

      expect(mockNumber.generate).not.toHaveBeenCalled();
      expect(mockDb.receipt.create).not.toHaveBeenCalled();
    });
  });

  describe('voidForPayment', () => {
    it('flips an ISSUED receipt to VOID and emits receipt.voided', async () => {
      mockDb.receipt.findUnique.mockResolvedValue({
        id: 'rcp-1',
        status: ReceiptStatus.ISSUED,
      });
      mockDb.receipt.update.mockResolvedValue({});

      await service.voidForPayment({
        payment_id: 'pay-1',
        invoice_id: 'inv-1',
        organization_id: ORG,
      });

      expect(mockDb.receipt.update.mock.calls[0][0].data.status).toBe(
        ReceiptStatus.VOID,
      );
      expect(mockEventBus.publish.mock.calls[0][0]).toBe('receipt.voided');
    });

    it('no-ops when no receipt exists', async () => {
      mockDb.receipt.findUnique.mockResolvedValue(null);
      await service.voidForPayment({
        payment_id: 'pay-x',
        invoice_id: 'inv-1',
        organization_id: ORG,
      });
      expect(mockDb.receipt.update).not.toHaveBeenCalled();
    });
  });

  describe('getReceipt', () => {
    it('returns a receipt after a branch access check', async () => {
      mockDb.receipt.findFirst.mockResolvedValue({
        id: 'rcp-1',
        branch_id: 'br-1',
      });

      const result = await service.getReceipt(ORG, 'rcp-1', USER);

      expect(mockAuth.assertCanAccessBranch).toHaveBeenCalledWith(
        'p1',
        ORG,
        'br-1',
      );
      expect(result.id).toBe('rcp-1');
    });

    it('404s a missing receipt', async () => {
      mockDb.receipt.findFirst.mockResolvedValue(null);
      await expect(service.getReceipt(ORG, 'missing', USER)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('print', () => {
    it('builds the printable aggregate', async () => {
      mockDb.receipt.findFirst.mockResolvedValue({
        receipt_number: 'RCP-2026-00001',
        issued_at: new Date('2026-06-09'),
        status: ReceiptStatus.ISSUED,
        currency: 'EGP',
        balance_after: d('120.00'),
        branch_id: 'br-1',
        organization: { id: 'org-1', name: 'Clinic', logo_object_key: null },
        branch: {
          id: 'br-1',
          name: 'Main',
          address: 'St 1',
          city: 'Cairo',
          governorate: 'Cairo',
        },
        patient: { id: 'pat-1', full_name: 'Jane Doe', phone_number: '0100' },
        invoice: {
          id: 'inv-1',
          invoice_number: 'INV-2026-00001',
          total_amount: d('200.00'),
        },
        payment: {
          id: 'pay-1',
          amount: d('80.00'),
          payment_method: PaymentMethod.CASH,
          payment_date: new Date('2026-06-09'),
        },
        issued_by: {
          id: 'p1',
          user: { first_name: 'Sara', last_name: 'Cashier' },
        },
      });

      const result = await service.print(ORG, 'rcp-1', USER);

      expect(result.receipt_number).toBe('RCP-2026-00001');
      expect(result.balance_after).toBe('120.00');
      expect(result.invoice.total_amount).toBe('200.00');
      expect(result.payment.amount).toBe('80.00');
      expect(result.issued_by.name).toBe('Sara Cashier');
      expect(mockAuth.assertCanAccessBranch).toHaveBeenCalledWith(
        'p1',
        ORG,
        'br-1',
      );
    });
  });
});
