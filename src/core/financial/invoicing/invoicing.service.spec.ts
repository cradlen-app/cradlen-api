import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ChargeStatus,
  DiscountType,
  InvoiceStatus,
  PricingSource,
  Prisma,
} from '@prisma/client';
import { InvoicingService } from './invoicing.service.js';
import { InvoiceNumberService } from './invoice-number.service.js';
import { InvoiceBalanceService } from './invoice-balance.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { FinancialAccessService } from '../shared/access/financial-access.service.js';
import { PricingResolverService } from '../pricing/pricing-resolver.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';

const d = (n: string) => new Prisma.Decimal(n);

const mockDb = {
  invoice: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  invoiceItem: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  charge: { findMany: jest.fn(), updateMany: jest.fn() },
  visit: { findFirst: jest.fn() },
  patientEpisode: { findFirst: jest.fn() },
  $transaction: jest.fn(),
};

const mockPrisma = { db: mockDb };
const mockAuth = {
  assertCanAccessBranch: jest.fn(),
  assertCanManageOrganization: jest.fn(),
};
const mockAccess = { assertIsReceptionistOrOwner: jest.fn() };
const mockResolver = { resolvePrice: jest.fn() };
const mockNumber = { generate: jest.fn() };
const mockBalance = { recompute: jest.fn() };
const mockEventBus = { publish: jest.fn() };

const ORG = 'org-1';
const BRANCH = 'br-1';
const USER: AuthContext = {
  userId: 'u1',
  profileId: 'p1',
  organizationId: ORG,
  roles: ['OWNER'],
  branchIds: [BRANCH],
};

describe('InvoicingService', () => {
  let service: InvoicingService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        InvoicingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuthorizationService, useValue: mockAuth },
        { provide: FinancialAccessService, useValue: mockAccess },
        { provide: PricingResolverService, useValue: mockResolver },
        { provide: InvoiceNumberService, useValue: mockNumber },
        { provide: InvoiceBalanceService, useValue: mockBalance },
        { provide: EventBus, useValue: mockEventBus },
      ],
    }).compile();

    service = module.get(InvoicingService);
    jest.clearAllMocks();
    mockAccess.assertIsReceptionistOrOwner.mockResolvedValue(undefined);
    mockAuth.assertCanAccessBranch.mockResolvedValue(undefined);
    mockNumber.generate.mockResolvedValue('INV-2026-00001');
    mockDb.$transaction.mockImplementation((fn) => fn(mockDb));
    mockDb.invoice.create.mockImplementation(({ data }) => ({
      id: 'inv-1',
      ...data,
    }));
    mockDb.invoice.update.mockImplementation(({ data }) => ({
      id: 'inv-1',
      ...data,
    }));
  });

  describe('create', () => {
    it('applies a PERCENTAGE invoice discount and seeds balance_due = total', async () => {
      await service.create(
        ORG,
        {
          branch_id: BRANCH,
          patient_id: 'pat-1',
          discount_type: DiscountType.PERCENTAGE,
          discount_value: 10,
          items: [{ description: 'A', unit_price: 100, quantity: 2 }],
        },
        USER,
      );

      const data = mockDb.invoice.create.mock.calls[0][0].data;
      expect(data.subtotal.toFixed(2)).toBe('200.00');
      expect(data.discount_amount.toFixed(2)).toBe('20.00');
      expect(data.total_amount.toFixed(2)).toBe('180.00');
      expect(data.balance_due.toFixed(2)).toBe('180.00');
    });
  });

  describe('buildFromCharges', () => {
    it('applies a FIXED discount and flips the charges to INVOICED', async () => {
      mockDb.charge.findMany.mockResolvedValue([
        {
          id: 'c1',
          service_id: null,
          description: 'A',
          quantity: 1,
          unit_price: d('100.00'),
          currency: 'EGP',
          pricing_source: PricingSource.CUSTOM,
        },
        {
          id: 'c2',
          service_id: null,
          description: 'B',
          quantity: 1,
          unit_price: d('100.00'),
          currency: 'EGP',
          pricing_source: PricingSource.CUSTOM,
        },
      ]);
      mockDb.charge.updateMany.mockResolvedValue({ count: 2 });

      await service.buildFromCharges(
        ORG,
        {
          branch_id: BRANCH,
          patient_id: 'pat-1',
          discount_type: DiscountType.FIXED,
          discount_value: 30,
        },
        USER,
      );

      const data = mockDb.invoice.create.mock.calls[0][0].data;
      expect(data.subtotal.toFixed(2)).toBe('200.00');
      expect(data.discount_amount.toFixed(2)).toBe('30.00');
      expect(data.total_amount.toFixed(2)).toBe('170.00');
      expect(data.balance_due.toFixed(2)).toBe('170.00');
      expect(mockDb.charge.updateMany.mock.calls[0][0].data.status).toBe(
        ChargeStatus.INVOICED,
      );
    });

    it('rejects when there are no open charges', async () => {
      mockDb.charge.findMany.mockResolvedValue([]);
      await expect(
        service.buildFromCharges(
          ORG,
          { branch_id: BRANCH, patient_id: 'pat-1' },
          USER,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    const draftInvoice = {
      id: 'inv-1',
      status: InvoiceStatus.DRAFT,
      branch_id: BRANCH,
      currency: 'EGP',
      subtotal: d('200.00'),
      discount_type: null,
      discount_value: null,
      discount_amount: d('0.00'),
      tax_amount: d('0.00'),
      total_amount: d('200.00'),
      paid_amount: d('0.00'),
    };

    it('recomputes totals when the discount changes (no item change)', async () => {
      mockDb.invoice.findFirst.mockResolvedValue(draftInvoice);

      await service.update(
        ORG,
        'inv-1',
        { discount_type: DiscountType.PERCENTAGE, discount_value: 25 },
        USER,
      );

      const data = mockDb.invoice.update.mock.calls[0][0].data;
      expect(data.discount_amount.toFixed(2)).toBe('50.00');
      expect(data.total_amount.toFixed(2)).toBe('150.00');
      expect(data.balance_due.toFixed(2)).toBe('150.00');
    });

    it('rejects modifying a non-DRAFT invoice', async () => {
      mockDb.invoice.findFirst.mockResolvedValue({
        ...draftInvoice,
        status: InvoiceStatus.ISSUED,
      });
      await expect(
        service.update(ORG, 'inv-1', { notes: 'x' }, USER),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('issue', () => {
    it('rejects issuing an invoice with no items', async () => {
      mockDb.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        status: InvoiceStatus.DRAFT,
        branch_id: BRANCH,
      });
      mockDb.invoiceItem.count.mockResolvedValue(0);
      await expect(service.issue(ORG, 'inv-1', USER)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('autoAppendChargeFromEvent', () => {
    const event = {
      organization_id: ORG,
      branch_id: BRANCH,
      visit_id: 'visit-1',
      charge_id: 'charge-1',
    };

    it('appends the charge to the episode open invoice', async () => {
      mockDb.visit.findFirst.mockResolvedValue({ episode_id: 'ep-1' });
      mockDb.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });
      const spy = jest
        .spyOn(service, 'appendChargesSystem')
        .mockResolvedValue({} as never);

      await service.autoAppendChargeFromEvent(event);

      expect(spy).toHaveBeenCalledWith(ORG, 'inv-1', ['charge-1'], {
        throwIfEmpty: false,
      });
    });

    it('no-ops when the episode has no open issued invoice', async () => {
      mockDb.visit.findFirst.mockResolvedValue({ episode_id: 'ep-1' });
      mockDb.invoice.findFirst.mockResolvedValue(null);
      const spy = jest
        .spyOn(service, 'appendChargesSystem')
        .mockResolvedValue({} as never);

      await service.autoAppendChargeFromEvent(event);

      expect(spy).not.toHaveBeenCalled();
    });

    it('no-ops when the charge has no visit', async () => {
      const spy = jest
        .spyOn(service, 'appendChargesSystem')
        .mockResolvedValue({} as never);

      await service.autoAppendChargeFromEvent({ ...event, visit_id: null });

      expect(spy).not.toHaveBeenCalled();
      expect(mockDb.visit.findFirst).not.toHaveBeenCalled();
    });
  });
});
