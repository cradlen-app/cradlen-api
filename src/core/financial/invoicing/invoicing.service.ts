import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChargeStatus,
  DiscountType,
  InvoiceStatus,
  InvoiceType,
  PricingSource,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { paginated } from '@common/utils/pagination.utils.js';
import { PricingResolverService } from '../pricing/pricing-resolver.service.js';
import { FinancialAccessService } from '../shared/access/financial-access.service.js';
import { Money } from '../shared/money/money.js';
import { DEFAULT_CURRENCY } from '../shared/currency.js';
import {
  FINANCIAL_EVENTS,
  type InvoiceIssuedEvent,
} from '../shared/events/financial-events.js';
import { InvoiceNumberService } from './invoice-number.service.js';
import { InvoiceBalanceService } from './invoice-balance.service.js';
import type {
  CreateInvoiceDto,
  InvoiceItemInputDto,
} from './dto/create-invoice.dto.js';
import type { UpdateInvoiceDto } from './dto/update-invoice.dto.js';
import type { BuildInvoiceFromChargesDto } from './dto/build-invoice-from-charges.dto.js';
import type { AppendChargesDto } from './dto/append-charges.dto.js';

export interface InvoiceFilters {
  branchId?: string;
  patientId?: string;
  episodeId?: string;
  status?: InvoiceStatus;
  invoiceType?: InvoiceType;
  dateFrom?: string;
  dateTo?: string;
}

interface ResolvedItem {
  service_id: string | undefined;
  charge_id?: string;
  description: string;
  quantity: number;
  unit_price: Prisma.Decimal;
  currency: string;
  discount_amount: Prisma.Decimal;
  total_amount: Prisma.Decimal;
  pricing_source: PricingSource;
}

/** Invoice-level discount declaration (type + raw value); resolved to an amount at compute time. */
interface InvoiceDiscountInput {
  type: DiscountType | null;
  value: Prisma.Decimal | null;
}

@Injectable()
export class InvoicingService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly access: FinancialAccessService,
    private readonly pricingResolver: PricingResolverService,
    private readonly invoiceNumberService: InvoiceNumberService,
    private readonly balanceService: InvoiceBalanceService,
    private readonly eventBus: EventBus,
  ) {}

  async findAll(
    organizationId: string,
    filters: InvoiceFilters,
    page = 1,
    limit = 20,
    user: AuthContext,
  ) {
    if (filters.branchId) {
      await this.authorizationService.assertCanAccessBranch(
        user.profileId,
        organizationId,
        filters.branchId,
      );
    } else {
      await this.authorizationService.assertCanManageOrganization(
        user.profileId,
        organizationId,
      );
    }

    const where: Prisma.InvoiceWhereInput = {
      organization_id: organizationId,
      is_deleted: false,
      ...(filters.branchId && { branch_id: filters.branchId }),
      ...(filters.patientId && { patient_id: filters.patientId }),
      ...(filters.episodeId && { episode_id: filters.episodeId }),
      ...(filters.status && { status: filters.status }),
      ...(filters.invoiceType && { invoice_type: filters.invoiceType }),
      ...(filters.dateFrom || filters.dateTo
        ? {
            created_at: {
              ...(filters.dateFrom && { gte: new Date(filters.dateFrom) }),
              // Inclusive upper bound: a date-only `dateTo` ("YYYY-MM-DD")
              // parses to midnight UTC, which would exclude everything created
              // later that day — so extend it to end-of-day.
              ...(filters.dateTo && { lte: this.endOfDay(filters.dateTo) }),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prismaService.db.invoice.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prismaService.db.invoice.count({ where }),
    ]);

    return paginated(items, { page, limit, total });
  }

  async findOne(organizationId: string, invoiceId: string, user: AuthContext) {
    const invoice = await this.prismaService.db.invoice.findFirst({
      where: {
        id: invoiceId,
        organization_id: organizationId,
        is_deleted: false,
      },
      include: {
        items: {
          where: { invoice_id: invoiceId },
          orderBy: { created_at: 'asc' },
        },
        payments: {
          where: { invoice_id: invoiceId, is_deleted: false },
          orderBy: { created_at: 'desc' },
        },
        patient: { select: { id: true, full_name: true } },
        assigned_doctor: {
          select: {
            id: true,
            user: { select: { first_name: true, last_name: true } },
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      organizationId,
      invoice.branch_id,
    );

    // Expose a flat `doctor` shape (matches the web EmbeddedPerson contract);
    // `patient` already carries `full_name` from the include.
    const { assigned_doctor, ...rest } = invoice;
    return {
      ...rest,
      doctor: assigned_doctor
        ? {
            id: assigned_doctor.id,
            first_name: assigned_doctor.user.first_name,
            last_name: assigned_doctor.user.last_name,
          }
        : null,
    };
  }

  async create(
    organizationId: string,
    dto: CreateInvoiceDto,
    user: AuthContext,
  ) {
    await this.access.assertIsReceptionistOrOwner(user, organizationId);
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      organizationId,
      dto.branch_id,
    );

    const currency = dto.currency ?? DEFAULT_CURRENCY;
    const invoiceNumber =
      await this.invoiceNumberService.generate(organizationId);

    const resolvedItems = await this.resolveItemPricing(
      dto.items ?? [],
      organizationId,
      dto.branch_id,
      user.profileId,
      currency,
    );

    const discount = this.discountFromDto(
      dto.discount_type,
      dto.discount_value,
    );
    const { subtotal, discountAmount, total } = this.computeTotals(
      resolvedItems,
      discount,
      Money.zero(),
    );

    const episodeId = await this.resolveEpisodeId(
      organizationId,
      dto.patient_id,
      dto.branch_id,
      dto.episode_id,
      dto.visit_id,
    );

    const invoice = await this.prismaService.db.invoice.create({
      data: {
        invoice_number: invoiceNumber,
        invoice_type: dto.invoice_type ?? InvoiceType.STANDARD,
        organization_id: organizationId,
        branch_id: dto.branch_id,
        patient_id: dto.patient_id,
        visit_id: dto.visit_id,
        episode_id: episodeId,
        assigned_doctor_id: dto.assigned_doctor_id,
        currency,
        notes: dto.notes,
        due_date: dto.due_date ? new Date(dto.due_date) : undefined,
        discount_type: discount.type,
        discount_value: discount.value,
        discount_amount: discountAmount,
        subtotal,
        total_amount: total,
        balance_due: total,
        created_by_id: user.profileId,
        items: resolvedItems.length
          ? { create: resolvedItems.map((item) => this.toItemData(item)) }
          : undefined,
      },
      include: { items: true },
    });

    this.publishCreated(invoice);
    return invoice;
  }

  /**
   * Assemble a DRAFT invoice from a patient's open charges: each PENDING charge
   * becomes an invoice line (linked via charge_id) and flips to INVOICED.
   */
  async buildFromCharges(
    organizationId: string,
    dto: BuildInvoiceFromChargesDto,
    user: AuthContext,
  ) {
    await this.access.assertIsReceptionistOrOwner(user, organizationId);
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      organizationId,
      dto.branch_id,
    );

    const invoiceNumber =
      await this.invoiceNumberService.generate(organizationId);

    const episodeId = await this.resolveEpisodeId(
      organizationId,
      dto.patient_id,
      dto.branch_id,
      dto.episode_id,
      dto.visit_id,
    );

    const invoice = await this.prismaService.db.$transaction(async (tx) => {
      const charges = await tx.charge.findMany({
        where: {
          organization_id: organizationId,
          branch_id: dto.branch_id,
          patient_id: dto.patient_id,
          status: ChargeStatus.PENDING,
          is_deleted: false,
          ...(dto.charge_ids?.length && { id: { in: dto.charge_ids } }),
        },
        orderBy: { captured_at: 'asc' },
      });

      if (charges.length === 0) {
        throw new BadRequestException('No open charges to invoice');
      }

      const currency = dto.currency ?? charges[0].currency;
      const items: ResolvedItem[] = charges.map((charge) => ({
        service_id: charge.service_id ?? undefined,
        charge_id: charge.id,
        description: charge.description,
        quantity: charge.quantity,
        unit_price: charge.unit_price,
        currency: charge.currency,
        discount_amount: Money.zero(),
        total_amount: Money.multiply(charge.unit_price, charge.quantity),
        pricing_source: charge.pricing_source,
      }));

      const discount = this.discountFromDto(
        dto.discount_type,
        dto.discount_value,
      );
      const { subtotal, discountAmount, total } = this.computeTotals(
        items,
        discount,
        Money.zero(),
      );

      const created = await tx.invoice.create({
        data: {
          invoice_number: invoiceNumber,
          invoice_type: dto.invoice_type ?? InvoiceType.STANDARD,
          organization_id: organizationId,
          branch_id: dto.branch_id,
          patient_id: dto.patient_id,
          visit_id: dto.visit_id,
          episode_id: episodeId,
          // The case's rendering provider — taken from the charges so the
          // invoice records (and can display) the doctor.
          assigned_doctor_id: charges[0].profile_id,
          currency,
          notes: dto.notes,
          due_date: dto.due_date ? new Date(dto.due_date) : undefined,
          discount_type: discount.type,
          discount_value: discount.value,
          discount_amount: discountAmount,
          subtotal,
          total_amount: total,
          balance_due: total,
          created_by_id: user.profileId,
          items: { create: items.map((item) => this.toItemData(item)) },
        },
        include: { items: true },
      });

      await tx.charge.updateMany({
        where: { id: { in: charges.map((c) => c.id) } },
        data: { status: ChargeStatus.INVOICED },
      });

      return created;
    });

    this.publishCreated(invoice);
    return invoice;
  }

  /**
   * Append a patient's open (PENDING) charges to an existing issued invoice —
   * the post-issue accrual path for a case billed across visits (e.g. a service
   * the doctor added mid-visit, or a later session of a multi-visit procedure).
   * Charges flip to INVOICED; the invoice's totals and lifecycle status are
   * recomputed (a fully-paid invoice reopens to PARTIALLY_PAID when a balance
   * reappears).
   */
  async appendCharges(
    organizationId: string,
    invoiceId: string,
    dto: AppendChargesDto,
    user: AuthContext,
  ) {
    await this.access.assertIsReceptionistOrOwner(user, organizationId);
    const invoice = await this.findOneOrThrow(organizationId, invoiceId);

    // DRAFT invoices accrue charges via the normal create/import path; VOID is
    // terminal. Only an already-issued, non-void invoice accrues here.
    if (
      invoice.status !== InvoiceStatus.ISSUED &&
      invoice.status !== InvoiceStatus.PARTIALLY_PAID &&
      invoice.status !== InvoiceStatus.PAID
    ) {
      throw new BadRequestException(
        'Charges can only be appended to an ISSUED, PARTIALLY_PAID, or PAID invoice',
      );
    }

    return this.prismaService.db.$transaction(async (tx) => {
      const charges = await tx.charge.findMany({
        where: {
          organization_id: organizationId,
          branch_id: invoice.branch_id,
          patient_id: invoice.patient_id,
          status: ChargeStatus.PENDING,
          is_deleted: false,
          ...(dto.charge_ids?.length && { id: { in: dto.charge_ids } }),
        },
        orderBy: { captured_at: 'asc' },
      });

      if (charges.length === 0) {
        throw new BadRequestException('No open charges to append');
      }

      await tx.invoiceItem.createMany({
        data: charges.map((charge) => ({
          invoice_id: invoiceId,
          ...this.toItemData({
            service_id: charge.service_id ?? undefined,
            charge_id: charge.id,
            description: charge.description,
            quantity: charge.quantity,
            unit_price: charge.unit_price,
            currency: charge.currency,
            discount_amount: Money.zero(),
            total_amount: Money.multiply(charge.unit_price, charge.quantity),
            pricing_source: charge.pricing_source,
          }),
        })),
      });

      await tx.charge.updateMany({
        where: { id: { in: charges.map((c) => c.id) } },
        data: { status: ChargeStatus.INVOICED },
      });

      // Recompute invoice-level totals from all items, preserving the existing
      // invoice-level discount and tax…
      const allItems = await tx.invoiceItem.findMany({
        where: { invoice_id: invoiceId },
      });
      const { subtotal, discountAmount, total } = this.computeTotals(
        allItems,
        { type: invoice.discount_type, value: invoice.discount_value },
        invoice.tax_amount,
      );
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          subtotal,
          discount_amount: discountAmount,
          total_amount: total,
        },
      });

      // …then recompute paid/balance/status from payments (reopens PAID →
      // PARTIALLY_PAID when the new total exceeds what's been paid).
      await this.balanceService.recompute(tx, invoiceId);

      return tx.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
        include: { items: true },
      });
    });
  }

  async update(
    organizationId: string,
    invoiceId: string,
    dto: UpdateInvoiceDto,
    user: AuthContext,
  ) {
    await this.access.assertIsReceptionistOrOwner(user, organizationId);
    const invoice = await this.findOneOrThrow(organizationId, invoiceId);
    this.assertDraft(invoice);

    const discountChanged =
      dto.discount_type !== undefined || dto.discount_value !== undefined;
    const discount: InvoiceDiscountInput = discountChanged
      ? this.discountFromDto(dto.discount_type, dto.discount_value)
      : { type: invoice.discount_type, value: invoice.discount_value };

    return this.prismaService.db.$transaction(async (tx) => {
      let subtotal = invoice.subtotal;
      let discountAmount = invoice.discount_amount;
      let total = invoice.total_amount;

      if (dto.items !== undefined) {
        await tx.invoiceItem.deleteMany({ where: { invoice_id: invoiceId } });

        const resolvedItems = await this.resolveItemPricing(
          dto.items,
          organizationId,
          invoice.branch_id,
          user.profileId,
          invoice.currency,
        );

        if (resolvedItems.length) {
          await tx.invoiceItem.createMany({
            data: resolvedItems.map((item) => ({
              invoice_id: invoiceId,
              ...this.toItemData(item),
            })),
          });
        }

        ({ subtotal, discountAmount, total } = this.computeTotals(
          resolvedItems,
          discount,
          invoice.tax_amount,
        ));
      } else if (discountChanged) {
        discountAmount = this.resolveInvoiceDiscount(
          invoice.subtotal,
          discount,
        );
        total = Prisma.Decimal.max(
          Money.zero(),
          invoice.subtotal.minus(discountAmount).plus(invoice.tax_amount),
        );
      }

      return tx.invoice.update({
        where: { id: invoiceId },
        data: {
          ...(dto.assigned_doctor_id !== undefined && {
            assigned_doctor_id: dto.assigned_doctor_id,
          }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(dto.due_date !== undefined && {
            due_date: new Date(dto.due_date),
          }),
          discount_type: discount.type,
          discount_value: discount.value,
          discount_amount: discountAmount,
          subtotal,
          total_amount: total,
          balance_due: Prisma.Decimal.max(
            Money.zero(),
            total.minus(invoice.paid_amount),
          ),
        },
        include: { items: true },
      });
    });
  }

  async addItem(
    organizationId: string,
    invoiceId: string,
    dto: InvoiceItemInputDto,
    user: AuthContext,
  ) {
    await this.access.assertIsReceptionistOrOwner(user, organizationId);
    const invoice = await this.findOneOrThrow(organizationId, invoiceId);
    this.assertDraft(invoice);

    const [resolved] = await this.resolveItemPricing(
      [dto],
      organizationId,
      invoice.branch_id,
      user.profileId,
      invoice.currency,
    );

    return this.prismaService.db.$transaction(async (tx) => {
      await tx.invoiceItem.create({
        data: { invoice_id: invoiceId, ...this.toItemData(resolved) },
      });

      const allItems = await tx.invoiceItem.findMany({
        where: { invoice_id: invoiceId },
      });
      const { subtotal, discountAmount, total } = this.computeTotals(
        allItems,
        { type: invoice.discount_type, value: invoice.discount_value },
        invoice.tax_amount,
      );

      return tx.invoice.update({
        where: { id: invoiceId },
        data: {
          subtotal,
          discount_amount: discountAmount,
          total_amount: total,
          balance_due: Prisma.Decimal.max(
            Money.zero(),
            total.minus(invoice.paid_amount),
          ),
        },
        include: { items: true },
      });
    });
  }

  async removeItem(
    organizationId: string,
    invoiceId: string,
    itemId: string,
    user: AuthContext,
  ) {
    await this.access.assertIsReceptionistOrOwner(user, organizationId);
    const invoice = await this.findOneOrThrow(organizationId, invoiceId);
    this.assertDraft(invoice);

    const item = await this.prismaService.db.invoiceItem.findFirst({
      where: { id: itemId, invoice_id: invoiceId },
    });
    if (!item) throw new NotFoundException('Invoice item not found');

    await this.prismaService.db.$transaction(async (tx) => {
      await tx.invoiceItem.delete({ where: { id: itemId } });

      const remaining = await tx.invoiceItem.findMany({
        where: { invoice_id: invoiceId },
      });
      const { subtotal, discountAmount, total } = this.computeTotals(
        remaining,
        { type: invoice.discount_type, value: invoice.discount_value },
        invoice.tax_amount,
      );

      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          subtotal,
          discount_amount: discountAmount,
          total_amount: total,
          balance_due: Prisma.Decimal.max(
            Money.zero(),
            total.minus(invoice.paid_amount),
          ),
        },
      });
    });
  }

  async issue(organizationId: string, invoiceId: string, user: AuthContext) {
    await this.access.assertIsReceptionistOrOwner(user, organizationId);
    const invoice = await this.findOneOrThrow(organizationId, invoiceId);
    this.assertDraft(invoice);

    const itemCount = await this.prismaService.db.invoiceItem.count({
      where: { invoice_id: invoiceId },
    });
    if (itemCount === 0) {
      throw new BadRequestException('Cannot issue an invoice with no items');
    }

    const issued = await this.prismaService.db.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.ISSUED, issued_at: new Date() },
    });

    this.eventBus.publish<InvoiceIssuedEvent>(FINANCIAL_EVENTS.invoice.issued, {
      invoice_id: issued.id,
      invoice_number: issued.invoice_number,
      organization_id: issued.organization_id,
      branch_id: issued.branch_id,
      patient_id: issued.patient_id,
      total_amount: issued.total_amount,
      issued_by_id: user.profileId,
    });
    return issued;
  }

  async void(organizationId: string, invoiceId: string, user: AuthContext) {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      organizationId,
    );
    const invoice = await this.findOneOrThrow(organizationId, invoiceId);

    if (
      invoice.status !== InvoiceStatus.DRAFT &&
      invoice.status !== InvoiceStatus.ISSUED
    ) {
      throw new BadRequestException(
        'Only DRAFT or ISSUED invoices can be voided',
      );
    }

    const voided = await this.prismaService.db.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.VOID },
    });
    this.eventBus.publish(FINANCIAL_EVENTS.invoice.voided, {
      invoice_id: voided.id,
      organization_id: organizationId,
    });
    return voided;
  }

  private publishCreated(invoice: {
    id: string;
    organization_id: string;
    branch_id: string;
    patient_id: string;
    total_amount: Prisma.Decimal;
  }): void {
    this.eventBus.publish(FINANCIAL_EVENTS.invoice.created, {
      invoice_id: invoice.id,
      organization_id: invoice.organization_id,
      branch_id: invoice.branch_id,
      patient_id: invoice.patient_id,
      total_amount: invoice.total_amount,
    });
  }

  private toItemData(item: ResolvedItem) {
    return {
      service_id: item.service_id,
      charge_id: item.charge_id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      currency: item.currency,
      discount_amount: item.discount_amount,
      total_amount: item.total_amount,
      pricing_source: item.pricing_source,
    };
  }

  private async resolveItemPricing(
    items: InvoiceItemInputDto[],
    organizationId: string,
    branchId: string,
    profileId: string,
    defaultCurrency: string,
  ): Promise<ResolvedItem[]> {
    return Promise.all(
      items.map(async (item) => {
        const quantity = item.quantity ?? 1;
        const discountAmount = Money.of(item.discount_amount ?? 0);
        let unitPrice: Prisma.Decimal;
        let currency = defaultCurrency;
        let pricingSource: PricingSource = PricingSource.CUSTOM;

        if (item.service_id) {
          const resolved = await this.pricingResolver.resolvePrice({
            organizationId,
            branchId,
            serviceId: item.service_id,
            profileId,
            quantity,
          });
          if (resolved) {
            unitPrice = resolved.price;
            currency = resolved.currency;
            pricingSource = resolved.source;
          } else {
            unitPrice = Money.of(item.unit_price);
          }
        } else {
          unitPrice = Money.of(item.unit_price);
        }

        const lineTotal = Money.subtract(
          Money.multiply(unitPrice, quantity),
          discountAmount,
        );
        const total_amount = Prisma.Decimal.max(Money.zero(), lineTotal);

        return {
          service_id: item.service_id,
          description: item.description,
          quantity,
          unit_price: unitPrice,
          currency,
          discount_amount: discountAmount,
          total_amount,
          pricing_source: pricingSource,
        };
      }),
    );
  }

  private discountFromDto(
    type?: DiscountType,
    value?: number,
  ): InvoiceDiscountInput {
    return {
      type: type ?? null,
      value: value !== undefined ? Money.of(value) : null,
    };
  }

  /**
   * Resolve an invoice-level discount declaration to a concrete amount, clamped
   * to [0, subtotal]. PERCENTAGE applies to the subtotal; FIXED is a flat amount.
   * Mirrors the pricing resolver's discount math.
   */
  private resolveInvoiceDiscount(
    subtotal: Prisma.Decimal,
    discount: InvoiceDiscountInput,
  ): Prisma.Decimal {
    if (discount.type === null || discount.value === null) return Money.zero();
    const amount =
      discount.type === DiscountType.PERCENTAGE
        ? Money.round(Money.multiply(subtotal, discount.value).dividedBy(100))
        : discount.value;
    return Prisma.Decimal.min(
      subtotal,
      Prisma.Decimal.max(Money.zero(), amount),
    );
  }

  private computeTotals(
    items: { total_amount: Prisma.Decimal }[],
    discount: InvoiceDiscountInput,
    taxAmount: Prisma.Decimal,
  ): {
    subtotal: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    total: Prisma.Decimal;
  } {
    const subtotal = Money.sum(items.map((item) => item.total_amount));
    const discountAmount = this.resolveInvoiceDiscount(subtotal, discount);
    const total = Prisma.Decimal.max(
      Money.zero(),
      subtotal.minus(discountAmount).plus(taxAmount),
    );
    return { subtotal, discountAmount, total };
  }

  private assertDraft(invoice: { status: InvoiceStatus; id: string }): void {
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        `Invoice ${invoice.id} is not in DRAFT status and cannot be modified`,
      );
    }
  }

  /**
   * The case (episode) an invoice bills. Prefer an explicit episode_id; otherwise
   * derive it from the originating visit so per-visit billing still groups under
   * its episode.
   *
   * Both ids are client-supplied, so each lookup is scoped to the invoice's
   * organization + patient (and branch, for the visit) — a foreign tenant's
   * episode/visit id must never be dereferenced and persisted onto the invoice.
   */
  private async resolveEpisodeId(
    organizationId: string,
    patientId: string,
    branchId: string,
    explicitEpisodeId: string | undefined,
    visitId: string | undefined,
  ): Promise<string | undefined> {
    if (explicitEpisodeId) {
      const episode = await this.prismaService.db.patientEpisode.findFirst({
        where: {
          id: explicitEpisodeId,
          is_deleted: false,
          journey: { organization_id: organizationId, patient_id: patientId },
        },
        select: { id: true },
      });
      if (!episode) {
        throw new BadRequestException('Invalid episode_id for this patient');
      }
      return episode.id;
    }
    if (!visitId) return undefined;
    const visit = await this.prismaService.db.visit.findFirst({
      where: {
        id: visitId,
        is_deleted: false,
        branch_id: branchId,
        episode: {
          journey: { organization_id: organizationId, patient_id: patientId },
        },
      },
      select: { episode_id: true },
    });
    return visit?.episode_id ?? undefined;
  }

  /** End of the given UTC day — inclusive upper bound for a date-only filter. */
  private endOfDay(date: string): Date {
    const end = new Date(date);
    end.setUTCHours(23, 59, 59, 999);
    return end;
  }

  private async findOneOrThrow(organizationId: string, invoiceId: string) {
    const invoice = await this.prismaService.db.invoice.findFirst({
      where: {
        id: invoiceId,
        organization_id: organizationId,
        is_deleted: false,
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }
}
