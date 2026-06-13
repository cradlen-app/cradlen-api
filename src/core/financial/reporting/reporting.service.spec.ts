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
  branch: { findMany: jest.fn() },
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

  describe('invoiceStats', () => {
    it('returns per-status counts/amounts and gates branch-scoped access', async () => {
      // Promise.all order in the service: paid, pending, overdue, unpaid.
      mockDb.invoice.aggregate
        .mockResolvedValueOnce({
          _sum: { total_amount: new Prisma.Decimal('1000.00') },
          _count: 4,
        })
        .mockResolvedValueOnce({
          _sum: { total_amount: new Prisma.Decimal('300.00') },
          _count: 2,
        })
        .mockResolvedValueOnce({
          _sum: { balance_due: new Prisma.Decimal('250.00') },
          _count: 3,
        })
        .mockResolvedValueOnce({
          _sum: { balance_due: null },
          _count: 0,
        });

      const result = await service.invoiceStats(ORG, { branchId: 'br-1' }, USER);

      expect(mockAuth.assertCanAccessBranch).toHaveBeenCalledWith(
        'p1',
        ORG,
        'br-1',
      );
      expect(result.paid.count).toBe(4);
      expect(result.paid.amount.toFixed(2)).toBe('1000.00');
      expect(result.pending.count).toBe(2);
      expect(result.pending.amount.toFixed(2)).toBe('300.00');
      expect(result.overdue.count).toBe(3);
      expect(result.overdue.amount.toFixed(2)).toBe('250.00');
      expect(result.unpaid.count).toBe(0);
      expect(result.unpaid.amount.toFixed(2)).toBe('0.00');
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

  describe('revenueByBranch', () => {
    it('groups by branch with billed/collected/outstanding and resolves names', async () => {
      mockDb.invoice.groupBy.mockResolvedValue([
        {
          branch_id: 'br-1',
          _sum: {
            total_amount: new Prisma.Decimal('300.00'),
            paid_amount: new Prisma.Decimal('200.00'),
            balance_due: new Prisma.Decimal('100.00'),
          },
          _count: 3,
        },
        {
          branch_id: null,
          _sum: {
            total_amount: new Prisma.Decimal('200.00'),
            paid_amount: new Prisma.Decimal('200.00'),
            balance_due: new Prisma.Decimal('0.00'),
          },
          _count: 2,
        },
      ] as never);
      mockDb.branch.findMany.mockResolvedValue([
        { id: 'br-1', name: 'Main Clinic' },
      ]);

      const result = await service.revenueByBranch(ORG, {}, USER);

      expect(mockAuth.assertCanManageOrganization).toHaveBeenCalledWith(
        'p1',
        ORG,
      );
      expect(result.by_branch[0].branch_name).toBe('Main Clinic');
      expect(result.by_branch[0].invoice_count).toBe(3);
      expect(result.by_branch[0].collected.toFixed(2)).toBe('200.00');
      expect(result.by_branch[0].outstanding.toFixed(2)).toBe('100.00');
      expect(result.by_branch[1].branch_name).toBe('Unassigned');
      expect(result.total.toFixed(2)).toBe('500.00');
    });
  });

  describe('collections', () => {
    it('resolves staff profile names for the by-staff breakdown', async () => {
      mockDb.payment.groupBy
        .mockResolvedValueOnce([
          {
            payment_method: 'CASH',
            _sum: { amount: new Prisma.Decimal('300.00') },
            _count: 3,
          },
        ])
        .mockResolvedValueOnce([
          {
            recorded_by_id: 'staff-1',
            _sum: { amount: new Prisma.Decimal('300.00') },
            _count: 3,
          },
        ]);
      mockDb.profile.findMany.mockResolvedValue([
        { id: 'staff-1', user: { first_name: 'Mona', last_name: 'Hassan' } },
      ]);

      const result = await service.collections(ORG, {}, USER);

      expect(result.by_staff[0].profile_id).toBe('staff-1');
      expect(result.by_staff[0].staff_name).toBe('Mona Hassan');
      expect(result.total.toFixed(2)).toBe('300.00');
    });
  });

  describe('outstandingInvoices', () => {
    it('lists unpaid invoices with aging and a total', async () => {
      const now = Date.now();
      const lastPaid = new Date(now - 5 * 86_400_000);
      mockDb.invoice.findMany.mockResolvedValue([
        {
          id: 'inv-1',
          invoice_number: 'INV-2026-00001',
          patient_id: 'pat-1',
          assigned_doctor_id: 'doc-1',
          status: 'PARTIALLY_PAID',
          total_amount: new Prisma.Decimal('200.00'),
          paid_amount: new Prisma.Decimal('50.00'),
          balance_due: new Prisma.Decimal('150.00'),
          issued_at: new Date(now - 40 * 86_400_000),
          due_date: null,
          created_at: new Date(now - 40 * 86_400_000),
          payments: [{ payment_date: lastPaid }],
        },
      ]);
      mockDb.patient.findMany.mockResolvedValue([
        { id: 'pat-1', full_name: 'Jane Doe' },
      ]);
      mockDb.profile.findMany.mockResolvedValue([
        { id: 'doc-1', user: { first_name: 'Sara', last_name: 'Ali' } },
      ]);

      const result = await service.outstandingInvoices(ORG, {}, USER);

      expect(result.count).toBe(1);
      expect(result.total_outstanding.toFixed(2)).toBe('150.00');
      expect(result.invoices[0].patient_name).toBe('Jane Doe');
      expect(result.invoices[0].doctor_name).toBe('Sara Ali');
      expect(result.invoices[0].last_payment_date).toBe(lastPaid);
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
