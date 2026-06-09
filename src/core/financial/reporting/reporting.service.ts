import { Injectable } from '@nestjs/common';
import {
  ChargeStatus,
  InvoiceStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { Money } from '../shared/money/money.js';

interface ReportScope {
  branchId?: string;
  dateFrom?: string;
  dateTo?: string;
}

type AgingBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';

/** Invoice statuses that represent realized billing (issued and beyond). */
const REVENUE_INVOICE_STATUSES = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.PAID,
  InvoiceStatus.REFUNDED,
];

/**
 * Read-only financial aggregations. This module never writes and never injects
 * a sibling financial service — it queries the read models directly and returns
 * derived totals.
 */
@Injectable()
export class ReportingService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async revenueSummary(
    organizationId: string,
    scope: ReportScope,
    user: AuthContext,
  ) {
    await this.authorizeScope(organizationId, scope.branchId, user);

    const where: Prisma.InvoiceWhereInput = {
      organization_id: organizationId,
      is_deleted: false,
      status: {
        in: [
          InvoiceStatus.ISSUED,
          InvoiceStatus.PARTIALLY_PAID,
          InvoiceStatus.PAID,
          InvoiceStatus.REFUNDED,
        ],
      },
      ...(scope.branchId && { branch_id: scope.branchId }),
      ...this.dateRange('issued_at', scope),
    };

    const aggregate = await this.prismaService.db.invoice.aggregate({
      where,
      _sum: { total_amount: true, paid_amount: true },
      _count: true,
    });

    const invoiced = aggregate._sum.total_amount ?? Money.zero();
    const collected = aggregate._sum.paid_amount ?? Money.zero();

    return {
      total_invoiced: invoiced,
      total_collected: collected,
      outstanding: Prisma.Decimal.max(
        Money.zero(),
        Money.subtract(invoiced, collected),
      ),
      invoice_count: aggregate._count,
    };
  }

  async arAging(organizationId: string, scope: ReportScope, user: AuthContext) {
    await this.authorizeScope(organizationId, scope.branchId, user);

    const invoices = await this.prismaService.db.invoice.findMany({
      where: {
        organization_id: organizationId,
        is_deleted: false,
        status: {
          in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID],
        },
        ...(scope.branchId && { branch_id: scope.branchId }),
      },
      select: {
        total_amount: true,
        paid_amount: true,
        issued_at: true,
        due_date: true,
        created_at: true,
      },
    });

    const buckets = {
      current: Money.zero(),
      d1_30: Money.zero(),
      d31_60: Money.zero(),
      d61_90: Money.zero(),
      d90_plus: Money.zero(),
    };
    const now = Date.now();

    for (const invoice of invoices) {
      const outstanding = Money.subtract(
        invoice.total_amount,
        invoice.paid_amount,
      );
      if (!Money.isPositive(outstanding)) continue;

      const reference =
        invoice.due_date ?? invoice.issued_at ?? invoice.created_at;
      const { bucket } = this.agingOf(reference, now);
      buckets[bucket] = Money.add(buckets[bucket], outstanding);
    }

    return {
      buckets,
      total_outstanding: Money.sum(Object.values(buckets)),
    };
  }

  async collections(
    organizationId: string,
    scope: ReportScope,
    user: AuthContext,
  ) {
    await this.authorizeScope(organizationId, scope.branchId, user);

    const where: Prisma.PaymentWhereInput = {
      is_deleted: false,
      status: PaymentStatus.COMPLETED,
      invoice: {
        organization_id: organizationId,
        is_deleted: false,
        ...(scope.branchId && { branch_id: scope.branchId }),
      },
      ...this.dateRange('payment_date', scope),
    };

    const [byMethod, byStaff] = await Promise.all([
      this.prismaService.db.payment.groupBy({
        by: ['payment_method'],
        where,
        _sum: { amount: true },
        _count: true,
      }),
      this.prismaService.db.payment.groupBy({
        by: ['recorded_by_id'],
        where,
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return {
      by_method: byMethod.map((row) => ({
        payment_method: row.payment_method,
        total: row._sum.amount ?? Money.zero(),
        count: row._count,
      })),
      by_staff: byStaff.map((row) => ({
        profile_id: row.recorded_by_id,
        total: row._sum.amount ?? Money.zero(),
        count: row._count,
      })),
      total: Money.sum(byMethod.map((row) => row._sum.amount ?? Money.zero())),
    };
  }

  async writeOffs(
    organizationId: string,
    scope: ReportScope,
    user: AuthContext,
  ) {
    await this.authorizeScope(organizationId, scope.branchId, user);

    const charges = await this.prismaService.db.charge.findMany({
      where: {
        organization_id: organizationId,
        is_deleted: false,
        status: ChargeStatus.WRITTEN_OFF,
        ...(scope.branchId && { branch_id: scope.branchId }),
        ...this.dateRange('updated_at', scope),
      },
      select: { unit_price: true, quantity: true },
    });

    const total = Money.sum(
      charges.map((charge) =>
        Money.multiply(charge.unit_price, charge.quantity),
      ),
    );

    return { total_written_off: total, count: charges.length };
  }

  /** Per-day billed (invoices by issued_at) and collected (payments by date). */
  async dailyRevenue(
    organizationId: string,
    scope: ReportScope,
    user: AuthContext,
  ) {
    await this.authorizeScope(organizationId, scope.branchId, user);

    const [invoices, payments] = await Promise.all([
      this.prismaService.db.invoice.findMany({
        where: {
          organization_id: organizationId,
          is_deleted: false,
          status: { in: REVENUE_INVOICE_STATUSES },
          ...(scope.branchId && { branch_id: scope.branchId }),
          ...this.dateRange('issued_at', scope),
        },
        select: { issued_at: true, total_amount: true },
      }),
      this.prismaService.db.payment.findMany({
        where: {
          is_deleted: false,
          status: PaymentStatus.COMPLETED,
          invoice: {
            organization_id: organizationId,
            is_deleted: false,
            ...(scope.branchId && { branch_id: scope.branchId }),
          },
          ...this.dateRange('payment_date', scope),
        },
        select: { payment_date: true, amount: true },
      }),
    ]);

    const rows = new Map<
      string,
      {
        invoiced: Prisma.Decimal;
        collected: Prisma.Decimal;
        invoice_count: number;
      }
    >();
    const at = (key: string) => {
      let row = rows.get(key);
      if (!row) {
        row = {
          invoiced: Money.zero(),
          collected: Money.zero(),
          invoice_count: 0,
        };
        rows.set(key, row);
      }
      return row;
    };

    for (const invoice of invoices) {
      if (!invoice.issued_at) continue;
      const row = at(this.dayKey(invoice.issued_at));
      row.invoiced = Money.add(row.invoiced, invoice.total_amount);
      row.invoice_count += 1;
    }
    for (const payment of payments) {
      const row = at(this.dayKey(payment.payment_date));
      row.collected = Money.add(row.collected, payment.amount);
    }

    return {
      rows: [...rows.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([date, v]) => ({ date, ...v })),
    };
  }

  /** Billed revenue grouped by service (from invoice line items). */
  async revenueByService(
    organizationId: string,
    scope: ReportScope,
    user: AuthContext,
  ) {
    await this.authorizeScope(organizationId, scope.branchId, user);

    const grouped = await this.prismaService.db.invoiceItem.groupBy({
      by: ['service_id'],
      where: {
        invoice: {
          organization_id: organizationId,
          is_deleted: false,
          status: { in: REVENUE_INVOICE_STATUSES },
          ...(scope.branchId && { branch_id: scope.branchId }),
          ...this.dateRange('issued_at', scope),
        },
      },
      _sum: { total_amount: true },
      _count: true,
    });

    const names = await this.resolveServiceNames(
      grouped
        .map((g) => g.service_id)
        .filter((id): id is string => id !== null),
    );

    const by_service = grouped.map((g) => ({
      service_id: g.service_id,
      service_name: g.service_id
        ? (names.get(g.service_id) ?? 'Unknown service')
        : 'Custom / Uncategorized',
      total: g._sum.total_amount ?? Money.zero(),
      line_count: g._count,
    }));

    return { by_service, total: Money.sum(by_service.map((r) => r.total)) };
  }

  /** Billed revenue grouped by the invoice's assigned doctor. */
  async revenueByDoctor(
    organizationId: string,
    scope: ReportScope,
    user: AuthContext,
  ) {
    await this.authorizeScope(organizationId, scope.branchId, user);

    const grouped = await this.prismaService.db.invoice.groupBy({
      by: ['assigned_doctor_id'],
      where: {
        organization_id: organizationId,
        is_deleted: false,
        status: { in: REVENUE_INVOICE_STATUSES },
        ...(scope.branchId && { branch_id: scope.branchId }),
        ...this.dateRange('issued_at', scope),
      },
      _sum: { total_amount: true },
      _count: true,
    });

    const names = await this.resolveDoctorNames(
      grouped
        .map((g) => g.assigned_doctor_id)
        .filter((id): id is string => id !== null),
    );

    const by_doctor = grouped.map((g) => ({
      profile_id: g.assigned_doctor_id,
      doctor_name: g.assigned_doctor_id
        ? (names.get(g.assigned_doctor_id) ?? 'Unknown')
        : 'Unassigned',
      total: g._sum.total_amount ?? Money.zero(),
      invoice_count: g._count,
    }));

    return { by_doctor, total: Money.sum(by_doctor.map((r) => r.total)) };
  }

  /** Unpaid invoices (balance_due > 0) with per-invoice aging. */
  async outstandingInvoices(
    organizationId: string,
    scope: ReportScope,
    user: AuthContext,
  ) {
    await this.authorizeScope(organizationId, scope.branchId, user);

    const invoices = await this.prismaService.db.invoice.findMany({
      where: {
        organization_id: organizationId,
        is_deleted: false,
        status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] },
        balance_due: { gt: 0 },
        ...(scope.branchId && { branch_id: scope.branchId }),
        ...this.dateRange('issued_at', scope),
      },
      select: {
        id: true,
        invoice_number: true,
        patient_id: true,
        status: true,
        total_amount: true,
        paid_amount: true,
        balance_due: true,
        issued_at: true,
        due_date: true,
        created_at: true,
      },
      orderBy: { balance_due: 'desc' },
    });

    const names = await this.resolvePatientNames([
      ...new Set(invoices.map((i) => i.patient_id)),
    ]);
    const now = Date.now();

    const rows = invoices.map((inv) => {
      const reference = inv.due_date ?? inv.issued_at ?? inv.created_at;
      const { age_days, bucket } = this.agingOf(reference, now);
      return {
        id: inv.id,
        invoice_number: inv.invoice_number,
        patient_id: inv.patient_id,
        patient_name: names.get(inv.patient_id) ?? 'Unknown',
        status: inv.status,
        total_amount: inv.total_amount,
        paid_amount: inv.paid_amount,
        balance_due: inv.balance_due,
        issued_at: inv.issued_at,
        due_date: inv.due_date,
        age_days,
        aging_bucket: bucket,
      };
    });

    return {
      invoices: rows,
      total_outstanding: Money.sum(invoices.map((i) => i.balance_due)),
      count: rows.length,
    };
  }

  /** Collected payments grouped by payment method. */
  async paymentsByMethod(
    organizationId: string,
    scope: ReportScope,
    user: AuthContext,
  ) {
    await this.authorizeScope(organizationId, scope.branchId, user);

    const byMethod = await this.prismaService.db.payment.groupBy({
      by: ['payment_method'],
      where: {
        is_deleted: false,
        status: PaymentStatus.COMPLETED,
        invoice: {
          organization_id: organizationId,
          is_deleted: false,
          ...(scope.branchId && { branch_id: scope.branchId }),
        },
        ...this.dateRange('payment_date', scope),
      },
      _sum: { amount: true },
      _count: true,
    });

    const by_method = byMethod.map((row) => ({
      payment_method: row.payment_method,
      total: row._sum.amount ?? Money.zero(),
      count: row._count,
    }));

    return { by_method, total: Money.sum(by_method.map((r) => r.total)) };
  }

  private async resolveServiceNames(
    ids: string[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prismaService.db.service.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async resolveDoctorNames(
    ids: string[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prismaService.db.profile.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        user: { select: { first_name: true, last_name: true } },
      },
    });
    return new Map(
      rows.map((r) => [r.id, `${r.user.first_name} ${r.user.last_name}`]),
    );
  }

  private async resolvePatientNames(
    ids: string[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prismaService.db.patient.findMany({
      where: { id: { in: ids } },
      select: { id: true, full_name: true },
    });
    return new Map(rows.map((r) => [r.id, r.full_name]));
  }

  private dayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private agingOf(
    reference: Date,
    now: number,
  ): { age_days: number; bucket: AgingBucket } {
    const age_days = Math.floor((now - reference.getTime()) / 86_400_000);
    const bucket: AgingBucket =
      age_days <= 0
        ? 'current'
        : age_days <= 30
          ? 'd1_30'
          : age_days <= 60
            ? 'd31_60'
            : age_days <= 90
              ? 'd61_90'
              : 'd90_plus';
    return { age_days, bucket };
  }

  private async authorizeScope(
    organizationId: string,
    branchId: string | undefined,
    user: AuthContext,
  ): Promise<void> {
    if (branchId) {
      await this.authorizationService.assertCanAccessBranch(
        user.profileId,
        organizationId,
        branchId,
      );
    } else {
      await this.authorizationService.assertCanManageOrganization(
        user.profileId,
        organizationId,
      );
    }
  }

  private dateRange(
    field: 'issued_at' | 'payment_date' | 'updated_at',
    scope: ReportScope,
  ): Record<string, Prisma.DateTimeFilter> | Record<string, never> {
    if (!scope.dateFrom && !scope.dateTo) return {};
    return {
      [field]: {
        ...(scope.dateFrom && { gte: new Date(scope.dateFrom) }),
        ...(scope.dateTo && { lte: new Date(scope.dateTo) }),
      },
    };
  }
}
