import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ReportingService } from './reporting.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';

const mockDb = {
  invoice: { aggregate: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
  invoiceItem: { groupBy: jest.fn() },
  payment: { groupBy: jest.fn(), findMany: jest.fn() },
  charge: { findMany: jest.fn() },
  service: { findMany: jest.fn() },
  profile: { findMany: jest.fn() },
  patient: { findMany: jest.fn() },
};
const mockPrisma = { db: mockDb };
const mockAuth = {
  assertCanAccessBranch: jest.fn(),
  assertCanManageOrganization: jest.fn(),
};

const ORG = 'org-1';
const USER: AuthContext = {
  userId: 'u1',
  profileId: 'p1',
  organizationId: ORG,
  roles: ['OWNER'],
  branchIds: ['br-1'],
};

describe('ReportingService', () => {
  let service: ReportingService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ReportingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuthorizationService, useValue: mockAuth },
      ],
    }).compile();

    service = module.get(ReportingService);
    jest.clearAllMocks();
  });

  describe('revenueSummary', () => {
    it('computes outstanding and gates org-wide on org management', async () => {
      mockDb.invoice.aggregate.mockResolvedValue({
        _sum: {
          total_amount: new Prisma.Decimal('1000.00'),
          paid_amount: new Prisma.Decimal('600.00'),
        },
        _count: 5,
      });

      const result = await service.revenueSummary(ORG, {}, USER);

      expect(mockAuth.assertCanManageOrganization).toHaveBeenCalledWith(
        'p1',
        ORG,
      );
      expect(result.outstanding.toFixed(2)).toBe('400.00');
      expect(result.invoice_count).toBe(5);
    });

    it('gates branch-scoped on branch access', async () => {
      mockDb.invoice.aggregate.mockResolvedValue({
        _sum: { total_amount: null, paid_amount: null },
        _count: 0,
      });

      await service.revenueSummary(ORG, { branchId: 'br-1' }, USER);

      expect(mockAuth.assertCanAccessBranch).toHaveBeenCalledWith(
        'p1',
        ORG,
        'br-1',
      );
      expect(mockAuth.assertCanManageOrganization).not.toHaveBeenCalled();
    });
  });

  describe('arAging', () => {
    it('buckets outstanding by age and skips settled invoices', async () => {
      const now = Date.now();
      const daysAgo = (d: number) => new Date(now - d * 86_400_000);
      mockDb.invoice.findMany.mockResolvedValue([
        {
          total_amount: new Prisma.Decimal('100.00'),
          paid_amount: new Prisma.Decimal('0.00'),
          issued_at: daysAgo(10),
          due_date: null,
          created_at: daysAgo(10),
        },
        {
          total_amount: new Prisma.Decimal('200.00'),
          paid_amount: new Prisma.Decimal('50.00'),
          issued_at: daysAgo(100),
          due_date: null,
          created_at: daysAgo(100),
        },
        {
          total_amount: new Prisma.Decimal('80.00'),
          paid_amount: new Prisma.Decimal('80.00'),
          issued_at: daysAgo(5),
          due_date: null,
          created_at: daysAgo(5),
        },
      ]);

      const result = await service.arAging(ORG, {}, USER);

      expect(result.buckets.d1_30.toFixed(2)).toBe('100.00');
      expect(result.buckets.d90_plus.toFixed(2)).toBe('150.00');
      expect(result.total_outstanding.toFixed(2)).toBe('250.00');
    });
  });

  describe('writeOffs', () => {
    it('sums written-off charge line totals', async () => {
      mockDb.charge.findMany.mockResolvedValue([
        { unit_price: new Prisma.Decimal('50.00'), quantity: 2 },
        { unit_price: new Prisma.Decimal('30.00'), quantity: 1 },
      ]);

      const result = await service.writeOffs(ORG, {}, USER);

      expect(result.total_written_off.toFixed(2)).toBe('130.00');
      expect(result.count).toBe(2);
    });
  });

  describe('dailyRevenue', () => {
    it('buckets invoiced and collected by day', async () => {
      mockDb.invoice.findMany.mockResolvedValue([
        {
          issued_at: new Date('2026-06-01T10:00:00Z'),
          total_amount: new Prisma.Decimal('100.00'),
        },
        {
          issued_at: new Date('2026-06-01T15:00:00Z'),
          total_amount: new Prisma.Decimal('50.00'),
        },
      ]);
      mockDb.payment.findMany.mockResolvedValue([
        {
          payment_date: new Date('2026-06-01T12:00:00Z'),
          amount: new Prisma.Decimal('80.00'),
        },
        {
          payment_date: new Date('2026-06-02T09:00:00Z'),
          amount: new Prisma.Decimal('40.00'),
        },
      ]);

      const result = await service.dailyRevenue(ORG, {}, USER);

      const day1 = result.rows.find((r) => r.date === '2026-06-01')!;
      expect(day1.invoiced.toFixed(2)).toBe('150.00');
      expect(day1.collected.toFixed(2)).toBe('80.00');
      expect(day1.invoice_count).toBe(2);
      const day2 = result.rows.find((r) => r.date === '2026-06-02')!;
      expect(day2.invoiced.toFixed(2)).toBe('0.00');
      expect(day2.collected.toFixed(2)).toBe('40.00');
      // sorted ascending
      expect(result.rows.map((r) => r.date)).toEqual([
        '2026-06-01',
        '2026-06-02',
      ]);
    });
  });

  describe('revenueByService', () => {
    it('groups by service, resolves names, and labels custom lines', async () => {
      mockDb.invoiceItem.groupBy.mockResolvedValue([
        {
          service_id: 'svc-1',
          _sum: { total_amount: new Prisma.Decimal('300.00') },
          _count: 3,
        },
        {
          service_id: null,
          _sum: { total_amount: new Prisma.Decimal('50.00') },
          _count: 1,
        },
      ]);
      mockDb.service.findMany.mockResolvedValue([
        { id: 'svc-1', name: 'Consultation' },
      ]);

      const result = await service.revenueByService(ORG, {}, USER);

      expect(result.by_service[0].service_name).toBe('Consultation');
      expect(result.by_service[1].service_name).toBe('Custom / Uncategorized');
      expect(result.total.toFixed(2)).toBe('350.00');
    });
  });

  describe('revenueByDoctor', () => {
    it('groups by assigned doctor with an Unassigned bucket', async () => {
      mockDb.invoice.groupBy.mockResolvedValue([
        {
          assigned_doctor_id: 'doc-1',
          _sum: { total_amount: new Prisma.Decimal('400.00') },
          _count: 2,
        },
        {
          assigned_doctor_id: null,
          _sum: { total_amount: new Prisma.Decimal('100.00') },
          _count: 1,
        },
      ]);
      mockDb.profile.findMany.mockResolvedValue([
        { id: 'doc-1', user: { first_name: 'Sara', last_name: 'Ali' } },
      ]);

      const result = await service.revenueByDoctor(ORG, {}, USER);

      expect(result.by_doctor[0].doctor_name).toBe('Sara Ali');
      expect(result.by_doctor[1].doctor_name).toBe('Unassigned');
      expect(result.total.toFixed(2)).toBe('500.00');
    });
  });

  describe('outstandingInvoices', () => {
    it('lists unpaid invoices with aging and a total', async () => {
      const now = Date.now();
      mockDb.invoice.findMany.mockResolvedValue([
        {
          id: 'inv-1',
          invoice_number: 'INV-2026-00001',
          patient_id: 'pat-1',
          status: 'PARTIALLY_PAID',
          total_amount: new Prisma.Decimal('200.00'),
          paid_amount: new Prisma.Decimal('50.00'),
          balance_due: new Prisma.Decimal('150.00'),
          issued_at: new Date(now - 40 * 86_400_000),
          due_date: null,
          created_at: new Date(now - 40 * 86_400_000),
        },
      ]);
      mockDb.patient.findMany.mockResolvedValue([
        { id: 'pat-1', full_name: 'Jane Doe' },
      ]);

      const result = await service.outstandingInvoices(ORG, {}, USER);

      expect(result.count).toBe(1);
      expect(result.total_outstanding.toFixed(2)).toBe('150.00');
      expect(result.invoices[0].patient_name).toBe('Jane Doe');
      expect(result.invoices[0].aging_bucket).toBe('d31_60');
    });
  });

  describe('paymentsByMethod', () => {
    it('groups completed payments by method', async () => {
      mockDb.payment.groupBy.mockResolvedValue([
        {
          payment_method: 'CASH',
          _sum: { amount: new Prisma.Decimal('300.00') },
          _count: 4,
        },
        {
          payment_method: 'CARD',
          _sum: { amount: new Prisma.Decimal('200.00') },
          _count: 2,
        },
      ]);

      const result = await service.paymentsByMethod(ORG, {}, USER);

      expect(result.by_method).toHaveLength(2);
      expect(result.total.toFixed(2)).toBe('500.00');
    });
  });
});
