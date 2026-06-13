import { Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, InvoiceType, Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { paginated } from '@common/utils/pagination.utils.js';
import { Money } from '../shared/money/money.js';
import { DEFAULT_CURRENCY } from '../shared/currency.js';
import { FinancialAccessService } from '../shared/access/financial-access.service.js';
import { FINANCIAL_EVENTS } from '../shared/events/financial-events.js';
import { InvoiceNumberService } from './invoice-number.service.js';
import {
  InvoiceCompositionService,
  type InvoiceDiscountInput,
} from './invoice-composition.service.js';
import { ChargeAccrualService } from './charge-accrual.service.js';
import { InvoiceLifecycleService } from './invoice-lifecycle.service.js';
import { InvoiceItemService } from './invoice-item.service.js';
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
  /** Filter by a set of clinical cases (episodes) — used by the billing queue. */
  episodeIds?: string[];
  status?: InvoiceStatus;
  invoiceType?: InvoiceType;
  dateFrom?: string;
  dateTo?: string;
  /** Free-text search across invoice_number and patient full_name. */
  search?: string;
}

/**
 * Invoice CRUD + orchestration facade. Owns the manual invoice reads/writes
 * (list, get, create, update) and delegates the specialised concerns to focused
 * collaborators: charge→invoice accrual (ChargeAccrualService), DRAFT line
 * editing (InvoiceItemService), and the issue/void lifecycle
 * (InvoiceLifecycleService). Shared assembly math lives in
 * InvoiceCompositionService. The controller, the visit-edit swap and the
 * charge.captured listener all enter through this one service.
 */
@Injectable()
export class InvoicingService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly access: FinancialAccessService,
    private readonly invoiceNumberService: InvoiceNumberService,
    private readonly composition: InvoiceCompositionService,
    private readonly accrual: ChargeAccrualService,
    private readonly lifecycle: InvoiceLifecycleService,
    private readonly items: InvoiceItemService,
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
      ...(filters.episodeIds?.length && {
        episode_id: { in: filters.episodeIds },
      }),
      ...(filters.status && { status: filters.status }),
      ...(filters.invoiceType && { invoice_type: filters.invoiceType }),
      ...(filters.search
        ? {
            OR: [
              {
                invoice_number: {
                  contains: filters.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                patient: {
                  full_name: {
                    contains: filters.search,
                    mode: 'insensitive' as const,
                  },
                },
              },
            ],
          }
        : {}),
      ...(filters.dateFrom || filters.dateTo
        ? {
            created_at: {
              ...(filters.dateFrom && { gte: new Date(filters.dateFrom) }),
              // Inclusive upper bound: a date-only `dateTo` ("YYYY-MM-DD")
              // parses to midnight UTC, which would exclude everything created
              // later that day — so extend it to end-of-day.
              ...(filters.dateTo && {
                lte: this.composition.endOfDay(filters.dateTo),
              }),
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
        include: {
          patient: { select: { id: true, full_name: true } },
        },
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

    const resolvedItems = await this.composition.resolveItemPricing(
      dto.items ?? [],
      organizationId,
      dto.branch_id,
      user.profileId,
      currency,
    );

    const discount = this.composition.discountFromDto(
      dto.discount_type,
      dto.discount_value,
    );
    const { subtotal, discountAmount, total } = this.composition.computeTotals(
      resolvedItems,
      discount,
      Money.zero(),
    );

    const episodeId = await this.composition.resolveEpisodeId(
      organizationId,
      dto.patient_id,
      dto.branch_id,
      dto.episode_id,
      dto.visit_id,
    );

    // Backfill the rendering provider from the linked visit when the caller
    // didn't pass one, so the invoice attributes to a doctor (and the By Doctor
    // report doesn't bucket it as "Unassigned"). Visit.assigned_doctor_id is
    // required, so the visit is a reliable source.
    let assignedDoctorId = dto.assigned_doctor_id;
    if (!assignedDoctorId && dto.visit_id) {
      const visit = await this.prismaService.db.visit.findUnique({
        where: { id: dto.visit_id },
        select: { assigned_doctor_id: true },
      });
      assignedDoctorId = visit?.assigned_doctor_id ?? undefined;
    }

    const invoice = await this.prismaService.db.invoice.create({
      data: {
        invoice_number: invoiceNumber,
        invoice_type: dto.invoice_type ?? InvoiceType.STANDARD,
        organization_id: organizationId,
        branch_id: dto.branch_id,
        patient_id: dto.patient_id,
        visit_id: dto.visit_id,
        episode_id: episodeId,
        assigned_doctor_id: assignedDoctorId,
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
          ? {
              create: resolvedItems.map((item) =>
                this.composition.toItemData(item),
              ),
            }
          : undefined,
      },
      include: { items: true },
    });

    this.publishCreated(invoice);
    return invoice;
  }

  async update(
    organizationId: string,
    invoiceId: string,
    dto: UpdateInvoiceDto,
    user: AuthContext,
  ) {
    await this.access.assertIsReceptionistOrOwner(user, organizationId);
    const invoice = await this.composition.findOneOrThrow(
      organizationId,
      invoiceId,
    );
    this.composition.assertDraft(invoice);

    const discountChanged =
      dto.discount_type !== undefined || dto.discount_value !== undefined;
    const discount: InvoiceDiscountInput = discountChanged
      ? this.composition.discountFromDto(dto.discount_type, dto.discount_value)
      : { type: invoice.discount_type, value: invoice.discount_value };

    return this.prismaService.db.$transaction(async (tx) => {
      let subtotal = invoice.subtotal;
      let discountAmount = invoice.discount_amount;
      let total = invoice.total_amount;

      if (dto.items !== undefined) {
        await tx.invoiceItem.deleteMany({ where: { invoice_id: invoiceId } });

        const resolvedItems = await this.composition.resolveItemPricing(
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
              ...this.composition.toItemData(item),
            })),
          });
        }

        ({ subtotal, discountAmount, total } = this.composition.computeTotals(
          resolvedItems,
          discount,
          invoice.tax_amount,
        ));
      } else if (discountChanged) {
        discountAmount = this.composition.resolveInvoiceDiscount(
          invoice.subtotal,
          discount,
        );
        total = Money.max(
          Money.zero(),
          Money.add(
            Money.subtract(invoice.subtotal, discountAmount),
            invoice.tax_amount,
          ),
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
          balance_due: Money.max(
            Money.zero(),
            Money.subtract(total, invoice.paid_amount),
          ),
        },
        include: { items: true },
      });
    });
  }

  // ---- Delegations to the focused collaborators -------------------------

  /** Assemble a DRAFT invoice from a patient's open charges. */
  buildFromCharges(
    organizationId: string,
    dto: BuildInvoiceFromChargesDto,
    user: AuthContext,
  ) {
    return this.accrual.buildFromCharges(organizationId, dto, user);
  }

  /** Append a patient's open charges to an existing issued invoice. */
  appendCharges(
    organizationId: string,
    invoiceId: string,
    dto: AppendChargesDto,
    user: AuthContext,
  ) {
    return this.accrual.appendCharges(organizationId, invoiceId, dto, user);
  }

  /** Event-driven auto-bill: land a captured charge on its case invoice. */
  ensureInvoiceForCharge(event: {
    organization_id: string;
    branch_id: string;
    patient_id: string;
    visit_id: string | null;
    charge_id: string;
    captured_by_id: string;
  }): Promise<void> {
    return this.accrual.ensureInvoiceForCharge(event);
  }

  /** Swap the visit's booking service on billing while the invoice is unpaid. */
  swapVisitBookingService(params: {
    organizationId: string;
    visitId: string;
    newServiceId: string;
    profileId: string;
    branchId: string;
    capturedById: string;
  }): Promise<void> {
    return this.accrual.swapVisitBookingService(params);
  }

  addItem(
    organizationId: string,
    invoiceId: string,
    dto: InvoiceItemInputDto,
    user: AuthContext,
  ) {
    return this.items.addItem(organizationId, invoiceId, dto, user);
  }

  removeItem(
    organizationId: string,
    invoiceId: string,
    itemId: string,
    user: AuthContext,
  ) {
    return this.items.removeItem(organizationId, invoiceId, itemId, user);
  }

  issue(organizationId: string, invoiceId: string, user: AuthContext) {
    return this.lifecycle.issue(organizationId, invoiceId, user);
  }

  void(organizationId: string, invoiceId: string, user: AuthContext) {
    return this.lifecycle.void(organizationId, invoiceId, user);
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
}
