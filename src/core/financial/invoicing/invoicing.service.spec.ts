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
import { InvoiceCompositionService } from './invoice-composition.service.js';
import { ChargeAccrualService } from './charge-accrual.service.js';
import { InvoiceLifecycleService } from './invoice-lifecycle.service.js';
import { InvoiceItemService } from './invoice-item.service.js';
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
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  invoiceItem: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  charge: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  service: { findFirst: jest.fn() },
  visit: { findFirst: jest.fn(), findUnique: jest.fn() },
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
  let accrual: ChargeAccrualService;
  let lifecycle: InvoiceLifecycleService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        InvoicingService,
        InvoiceCompositionService,
        ChargeAccrualService,
        InvoiceLifecycleService,
        InvoiceItemService,
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
    accrual = module.get(ChargeAccrualService);
    lifecycle = module.get(InvoiceLifecycleService);
    jest.clearAllMocks();
    mockAccess.assertIsReceptionistOrOwner.mockResolvedValue(undefined);
    mockAuth.assertCanAccessBranch.mockResolvedValue(undefined);
    mockAuth.assertCanManageOrganization.mockResolvedValue(undefined);
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

  describe('findAll', () => {
    beforeEach(() => {
      mockDb.invoice.findMany.mockResolvedValue([
        { id: 'inv-1' },
        { id: 'inv-2' },
      ]);
      mockDb.invoice.count.mockResolvedValue(2);
    });

    it('embeds patient {id, full_name} and omits the search OR when no search is given', async () => {
      await service.findAll(ORG, {}, 1, 20, USER);

      const args = mockDb.invoice.findMany.mock.calls[0][0];
      expect(args.include).toEqual({
        patient: { select: { id: true, full_name: true } },
      });
      expect(args.where.OR).toBeUndefined();
      expect(args.where.organization_id).toBe(ORG);
      expect(mockAuth.assertCanManageOrganization).toHaveBeenCalled();
    });

    it('builds a case-insensitive OR over invoice_number and patient.full_name when searching', async () => {
      await service.findAll(ORG, { search: 'ali' }, 1, 20, USER);

      const args = mockDb.invoice.findMany.mock.calls[0][0];
      expect(args.where.OR).toEqual([
        { invoice_number: { contains: 'ali', mode: 'insensitive' } },
        { patient: { full_name: { contains: 'ali', mode: 'insensitive' } } },
      ]);
    });

    it('scopes to the branch (assertCanAccessBranch) when branchId is supplied', async () => {
      await service.findAll(ORG, { branchId: BRANCH }, 1, 20, USER);

      const args = mockDb.invoice.findMany.mock.calls[0][0];
      expect(args.where.branch_id).toBe(BRANCH);
      expect(mockAuth.assertCanAccessBranch).toHaveBeenCalledWith(
        USER.profileId,
        ORG,
        BRANCH,
      );
    });

    it('filters by a set of episodes (episode_id IN) regardless of created_at — the billing-queue path', async () => {
      await service.findAll(
        ORG,
        { branchId: BRANCH, episodeIds: ['ep-1', 'ep-2'] },
        1,
        20,
        USER,
      );

      const args = mockDb.invoice.findMany.mock.calls[0][0];
      expect(args.where.episode_id).toEqual({ in: ['ep-1', 'ep-2'] });
      // no date constraint is applied for this path
      expect(args.where.created_at).toBeUndefined();
    });

    it('returns paginated meta (page/limit/total/totalPages)', async () => {
      mockDb.invoice.count.mockResolvedValue(25);
      const res = await service.findAll(ORG, {}, 2, 10, USER);

      expect(res.meta).toMatchObject({
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3,
      });
      // page 2 skips the first page's rows
      expect(mockDb.invoice.findMany.mock.calls[0][0]).toMatchObject({
        skip: 10,
        take: 10,
      });
    });
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

  describe('create() doctor backfill', () => {
    const baseDto = {
      branch_id: BRANCH,
      patient_id: 'pat-1',
      items: [{ description: 'A', unit_price: 100, quantity: 1 }],
    };

    it('backfills assigned_doctor_id from the visit when the dto omits it', async () => {
      mockDb.visit.findUnique.mockResolvedValue({
        assigned_doctor_id: 'doc-v',
      });

      await service.create(ORG, { ...baseDto, visit_id: 'v1' }, USER);

      const data = mockDb.invoice.create.mock.calls[0][0].data;
      expect(data.assigned_doctor_id).toBe('doc-v');
      expect(mockDb.visit.findUnique).toHaveBeenCalledWith({
        where: { id: 'v1' },
        select: { assigned_doctor_id: true },
      });
    });

    it('keeps an explicit assigned_doctor_id and skips the visit lookup', async () => {
      await service.create(
        ORG,
        { ...baseDto, visit_id: 'v1', assigned_doctor_id: 'doc-explicit' },
        USER,
      );

      const data = mockDb.invoice.create.mock.calls[0][0].data;
      expect(data.assigned_doctor_id).toBe('doc-explicit');
      expect(mockDb.visit.findUnique).not.toHaveBeenCalled();
    });

    it('leaves the doctor unset when there is no visit and no explicit doctor', async () => {
      await service.create(ORG, baseDto, USER);

      const data = mockDb.invoice.create.mock.calls[0][0].data;
      expect(data.assigned_doctor_id).toBeUndefined();
      expect(mockDb.visit.findUnique).not.toHaveBeenCalled();
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

  describe('addChargesToDraftSystem', () => {
    const draft = {
      id: 'inv-draft',
      status: InvoiceStatus.DRAFT,
      branch_id: BRANCH,
      patient_id: 'pat-1',
      discount_type: null,
      discount_value: null,
      tax_amount: d('0.00'),
    };

    it('adds the charge and recomputes totals, keeping the invoice DRAFT', async () => {
      mockDb.invoice.findFirst.mockResolvedValue(draft);
      mockDb.charge.findMany.mockResolvedValue([
        {
          id: 'c1',
          service_id: null,
          description: 'Consultation',
          quantity: 1,
          unit_price: d('150.00'),
          currency: 'EGP',
          pricing_source: PricingSource.CUSTOM,
        },
      ]);
      mockDb.charge.updateMany.mockResolvedValue({ count: 1 });
      mockDb.invoiceItem.findMany.mockResolvedValue([
        { total_amount: d('150.00') },
      ]);

      await accrual.addChargesToDraftSystem(ORG, 'inv-draft', ['c1']);

      const data = mockDb.invoice.update.mock.calls[0][0].data;
      expect(data.subtotal.toFixed(2)).toBe('150.00');
      expect(data.total_amount.toFixed(2)).toBe('150.00');
      expect(data.balance_due.toFixed(2)).toBe('150.00');
      // The draft is NOT issued — recompute would have derived a status.
      expect(data.status).toBeUndefined();
      expect(mockBalance.recompute).not.toHaveBeenCalled();
      expect(mockDb.charge.updateMany.mock.calls[0][0].data.status).toBe(
        ChargeStatus.INVOICED,
      );
    });

    it('rejects a non-DRAFT invoice', async () => {
      mockDb.invoice.findFirst.mockResolvedValue({
        ...draft,
        status: InvoiceStatus.ISSUED,
      });
      await expect(
        accrual.addChargesToDraftSystem(ORG, 'inv-draft', ['c1']),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('ensureInvoiceForCharge', () => {
    const event = {
      organization_id: ORG,
      branch_id: BRANCH,
      patient_id: 'pat-1',
      visit_id: 'visit-1',
      charge_id: 'charge-1',
      captured_by_id: 'rec-1',
    };

    it('appends the charge to an already-issued case invoice', async () => {
      mockDb.visit.findFirst.mockResolvedValue({ episode_id: 'ep-1' });
      mockDb.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        status: InvoiceStatus.ISSUED,
      });
      const append = jest
        .spyOn(accrual, 'appendChargesSystem')
        .mockResolvedValue({} as never);
      const draft = jest
        .spyOn(accrual, 'addChargesToDraftSystem')
        .mockResolvedValue({} as never);
      const build = jest
        .spyOn(accrual, 'buildFromChargesSystem')
        .mockResolvedValue({ id: 'inv-new' } as never);

      await service.ensureInvoiceForCharge(event);

      expect(append).toHaveBeenCalledWith(ORG, 'inv-1', ['charge-1'], {
        throwIfEmpty: false,
      });
      expect(draft).not.toHaveBeenCalled();
      expect(build).not.toHaveBeenCalled();
    });

    it('adds the charge to an existing DRAFT, keeping it DRAFT', async () => {
      mockDb.visit.findFirst.mockResolvedValue({ episode_id: 'ep-1' });
      mockDb.invoice.findFirst.mockResolvedValue({
        id: 'inv-draft',
        status: InvoiceStatus.DRAFT,
      });
      const draft = jest
        .spyOn(accrual, 'addChargesToDraftSystem')
        .mockResolvedValue({} as never);
      const append = jest
        .spyOn(accrual, 'appendChargesSystem')
        .mockResolvedValue({} as never);

      await service.ensureInvoiceForCharge(event);

      expect(draft).toHaveBeenCalledWith(ORG, 'inv-draft', ['charge-1']);
      expect(append).not.toHaveBeenCalled();
    });

    it('creates and issues a new invoice when the case has none', async () => {
      mockDb.visit.findFirst.mockResolvedValue({ episode_id: 'ep-1' });
      mockDb.invoice.findFirst.mockResolvedValue(null);
      const build = jest
        .spyOn(accrual, 'buildFromChargesSystem')
        .mockResolvedValue({ id: 'inv-new' } as never);
      const issue = jest
        .spyOn(lifecycle, 'issueSystem')
        .mockResolvedValue({} as never);

      await service.ensureInvoiceForCharge(event);

      expect(build).toHaveBeenCalledWith(
        ORG,
        {
          branch_id: BRANCH,
          patient_id: 'pat-1',
          visit_id: 'visit-1',
          charge_ids: ['charge-1'],
        },
        'rec-1',
      );
      expect(issue).toHaveBeenCalledWith(ORG, 'inv-new', 'rec-1');
    });

    it('no-ops when the charge has no visit', async () => {
      const build = jest
        .spyOn(accrual, 'buildFromChargesSystem')
        .mockResolvedValue({} as never);

      await service.ensureInvoiceForCharge({ ...event, visit_id: null });

      expect(build).not.toHaveBeenCalled();
      expect(mockDb.visit.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('swapVisitBookingService', () => {
    const params = {
      organizationId: ORG,
      visitId: 'visit-1',
      newServiceId: 'svc-new',
      profileId: 'doc-1',
      branchId: BRANCH,
      capturedById: 'rec-1',
    };

    const bookingCharge = {
      id: 'chg-old',
      service_id: 'svc-old',
      patient_id: 'pat-1',
      quantity: 1,
    };

    beforeEach(() => {
      mockResolver.resolvePrice.mockResolvedValue({
        price: d('150'),
        currency: 'EGP',
        source: PricingSource.CUSTOM,
      });
      mockDb.service.findFirst.mockResolvedValue({ name: 'New Service' });
      mockDb.charge.create.mockResolvedValue({ id: 'chg-new' });
      mockDb.invoiceItem.findMany.mockResolvedValue([
        { total_amount: d('150') },
      ]);
    });

    function mockUnpaidIssuedInvoice() {
      mockDb.charge.findFirst.mockResolvedValue(bookingCharge);
      mockDb.invoiceItem.findFirst.mockResolvedValue({
        id: 'item-old',
        invoice: {
          id: 'inv-1',
          status: InvoiceStatus.ISSUED,
          paid_amount: d('0'),
          discount_type: null,
          discount_value: null,
          tax_amount: d('0'),
        },
      });
    }

    it('voids the old charge, replaces the invoice line, and recomputes totals (unpaid ISSUED)', async () => {
      mockUnpaidIssuedInvoice();

      await service.swapVisitBookingService(params);

      expect(mockDb.charge.update).toHaveBeenCalledWith({
        where: { id: 'chg-old' },
        data: { status: ChargeStatus.VOID },
      });
      const created = mockDb.charge.create.mock.calls[0][0].data;
      expect(created).toMatchObject({
        service_id: 'svc-new',
        visit_id: 'visit-1',
        profile_id: 'doc-1',
        status: ChargeStatus.INVOICED,
      });
      expect(created.unit_price.toFixed(2)).toBe('150.00');
      expect(mockDb.invoiceItem.delete).toHaveBeenCalledWith({
        where: { id: 'item-old' },
      });
      expect(mockDb.invoiceItem.create).toHaveBeenCalled();
      expect(mockBalance.recompute).toHaveBeenCalledWith(mockDb, 'inv-1');
    });

    it('blocks the swap when a payment has been recorded (unpaid guard)', async () => {
      mockDb.charge.findFirst.mockResolvedValue(bookingCharge);
      mockDb.invoiceItem.findFirst.mockResolvedValue({
        id: 'item-old',
        invoice: {
          id: 'inv-1',
          status: InvoiceStatus.PARTIALLY_PAID,
          paid_amount: d('50'),
          discount_type: null,
          discount_value: null,
          tax_amount: d('0'),
        },
      });

      await expect(service.swapVisitBookingService(params)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockDb.charge.update).not.toHaveBeenCalled();
      expect(mockDb.charge.create).not.toHaveBeenCalled();
      expect(mockDb.invoiceItem.delete).not.toHaveBeenCalled();
    });

    it('no-ops when the service is unchanged', async () => {
      mockDb.charge.findFirst.mockResolvedValue({
        ...bookingCharge,
        service_id: 'svc-new',
      });

      await service.swapVisitBookingService(params);

      expect(mockResolver.resolvePrice).not.toHaveBeenCalled();
      expect(mockDb.$transaction).not.toHaveBeenCalled();
    });

    it('no-ops when the visit has no booking charge', async () => {
      mockDb.charge.findFirst.mockResolvedValue(null);

      await service.swapVisitBookingService(params);

      expect(mockResolver.resolvePrice).not.toHaveBeenCalled();
      expect(mockDb.$transaction).not.toHaveBeenCalled();
    });
  });
});
