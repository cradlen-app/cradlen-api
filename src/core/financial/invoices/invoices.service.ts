import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceStatus,
  InvoiceType,
  PaymentStatus,
  Prisma,
  PricingSource,
} from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { paginated } from '@common/utils/pagination.utils.js';
import { PricingResolverService } from '@core/financial/pricing/pricing-resolver.service.js';
import { InvoiceNumberService } from './invoice-number.service.js';
import type {
  CreateInvoiceDto,
  InvoiceItemInputDto,
} from './dto/create-invoice.dto.js';
import type { UpdateInvoiceDto } from './dto/update-invoice.dto.js';
import type { RecordPaymentDto } from './dto/record-payment.dto.js';

export interface InvoiceFilters {
  branchId?: string;
  patientId?: string;
  status?: InvoiceStatus;
  invoiceType?: InvoiceType;
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly pricingResolver: PricingResolverService,
    private readonly invoiceNumberService: InvoiceNumberService,
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
      await this.assertIsReceptionistOrOwner(user, organizationId);
    }

    const where: Prisma.InvoiceWhereInput = {
      organization_id: organizationId,
      is_deleted: false,
      ...(filters.branchId && { branch_id: filters.branchId }),
      ...(filters.patientId && { patient_id: filters.patientId }),
      ...(filters.status && { status: filters.status }),
      ...(filters.invoiceType && { invoice_type: filters.invoiceType }),
      ...(filters.dateFrom || filters.dateTo
        ? {
            created_at: {
              ...(filters.dateFrom && { gte: new Date(filters.dateFrom) }),
              ...(filters.dateTo && { lte: new Date(filters.dateTo) }),
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

  async findOne(organizationId: string, invoiceId: string) {
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
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async create(
    organizationId: string,
    dto: CreateInvoiceDto,
    user: AuthContext,
  ) {
    await this.assertIsReceptionistOrOwner(user, organizationId);

    const currency = dto.currency ?? 'EGP';
    const invoiceNumber =
      await this.invoiceNumberService.generate(organizationId);

    const resolvedItems = await this.resolveItemPricing(
      dto.items ?? [],
      organizationId,
      dto.branch_id,
      user.profileId,
      currency,
    );

    const { subtotal, total } = this.computeTotals(
      resolvedItems,
      new Prisma.Decimal(0),
      new Prisma.Decimal(0),
    );

    const invoice = await this.prismaService.db.invoice.create({
      data: {
        invoice_number: invoiceNumber,
        invoice_type: dto.invoice_type ?? InvoiceType.STANDARD,
        organization_id: organizationId,
        branch_id: dto.branch_id,
        patient_id: dto.patient_id,
        visit_id: dto.visit_id,
        assigned_doctor_id: dto.assigned_doctor_id,
        currency,
        notes: dto.notes,
        due_date: dto.due_date ? new Date(dto.due_date) : undefined,
        subtotal,
        total_amount: total,
        created_by_id: user.profileId,
        items: resolvedItems.length
          ? {
              create: resolvedItems.map((item) => ({
                service_id: item.service_id,
                description: item.description,
                quantity: item.quantity,
                unit_price: item.unit_price,
                currency: item.currency,
                discount_amount: item.discount_amount,
                total_amount: item.total_amount,
                pricing_source: item.pricing_source,
              })),
            }
          : undefined,
      },
      include: { items: true },
    });

    return invoice;
  }

  async update(
    organizationId: string,
    invoiceId: string,
    dto: UpdateInvoiceDto,
    user: AuthContext,
  ) {
    await this.assertIsReceptionistOrOwner(user, organizationId);
    const invoice = await this.findOneOrThrow(organizationId, invoiceId);
    this.assertDraft(invoice);

    return this.prismaService.db.$transaction(async (tx) => {
      let subtotal = invoice.subtotal;
      let total = invoice.total_amount;
      const discountAmount =
        dto.discount_amount !== undefined
          ? new Prisma.Decimal(dto.discount_amount)
          : invoice.discount_amount;

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
              service_id: item.service_id,
              description: item.description,
              quantity: item.quantity,
              unit_price: item.unit_price,
              currency: item.currency,
              discount_amount: item.discount_amount,
              total_amount: item.total_amount,
              pricing_source: item.pricing_source,
            })),
          });
        }

        const computed = this.computeTotals(
          resolvedItems,
          discountAmount,
          invoice.tax_amount,
        );
        subtotal = computed.subtotal;
        total = computed.total;
      } else if (dto.discount_amount !== undefined) {
        subtotal = invoice.subtotal;
        total = Prisma.Decimal.max(
          new Prisma.Decimal(0),
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
          ...(dto.discount_amount !== undefined && {
            discount_amount: discountAmount,
          }),
          subtotal,
          total_amount: total,
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
    await this.assertIsReceptionistOrOwner(user, organizationId);
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
        data: {
          invoice_id: invoiceId,
          service_id: resolved.service_id,
          description: resolved.description,
          quantity: resolved.quantity,
          unit_price: resolved.unit_price,
          currency: resolved.currency,
          discount_amount: resolved.discount_amount,
          total_amount: resolved.total_amount,
          pricing_source: resolved.pricing_source,
        },
      });

      const allItems = await tx.invoiceItem.findMany({
        where: { invoice_id: invoiceId },
      });
      const { subtotal, total } = this.computeTotals(
        allItems.map((i) => ({
          ...i,
          unit_price: i.unit_price,
          quantity: i.quantity,
          discount_amount: i.discount_amount,
          total_amount: i.total_amount,
        })),
        invoice.discount_amount,
        invoice.tax_amount,
      );

      return tx.invoice.update({
        where: { id: invoiceId },
        data: { subtotal, total_amount: total },
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
    await this.assertIsReceptionistOrOwner(user, organizationId);
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
      const { subtotal, total } = this.computeTotals(
        remaining.map((i) => ({
          ...i,
          unit_price: i.unit_price,
          quantity: i.quantity,
          discount_amount: i.discount_amount,
          total_amount: i.total_amount,
        })),
        invoice.discount_amount,
        invoice.tax_amount,
      );

      await tx.invoice.update({
        where: { id: invoiceId },
        data: { subtotal, total_amount: total },
      });
    });
  }

  async issue(organizationId: string, invoiceId: string, user: AuthContext) {
    await this.assertIsReceptionistOrOwner(user, organizationId);
    const invoice = await this.findOneOrThrow(organizationId, invoiceId);
    this.assertDraft(invoice);

    const itemCount = await this.prismaService.db.invoiceItem.count({
      where: { invoice_id: invoiceId },
    });
    if (itemCount === 0) {
      throw new BadRequestException('Cannot issue an invoice with no items');
    }

    return this.prismaService.db.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.ISSUED, issued_at: new Date() },
    });
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

    return this.prismaService.db.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.VOID },
    });
  }

  async recordPayment(
    organizationId: string,
    invoiceId: string,
    dto: RecordPaymentDto,
    user: AuthContext,
  ) {
    await this.assertIsReceptionistOrOwner(user, organizationId);
    const invoice = await this.findOneOrThrow(organizationId, invoiceId);

    if (
      invoice.status !== InvoiceStatus.ISSUED &&
      invoice.status !== InvoiceStatus.PARTIALLY_PAID
    ) {
      throw new BadRequestException(
        'Payments can only be recorded on ISSUED or PARTIALLY_PAID invoices',
      );
    }

    return this.prismaService.db.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          invoice_id: invoiceId,
          amount: new Prisma.Decimal(dto.amount),
          currency: dto.currency ?? invoice.currency,
          status: PaymentStatus.COMPLETED,
          payment_method: dto.payment_method,
          payment_date: dto.payment_date
            ? new Date(dto.payment_date)
            : new Date(),
          reference_number: dto.reference_number,
          notes: dto.notes,
          recorded_by_id: user.profileId,
        },
      });

      const payments = await tx.payment.findMany({
        where: {
          invoice_id: invoiceId,
          is_deleted: false,
          status: PaymentStatus.COMPLETED,
        },
        select: { amount: true },
      });

      const paidAmount = payments.reduce(
        (acc, p) => acc.plus(p.amount),
        new Prisma.Decimal(0),
      );

      const newStatus = this.deriveStatus(invoice.total_amount, paidAmount);

      return tx.invoice.update({
        where: { id: invoiceId },
        data: { paid_amount: paidAmount, status: newStatus },
      });
    });
  }

  async assertViewAccess(user: AuthContext, organizationId: string): Promise<void> {
    await this.assertIsReceptionistOrOwner(user, organizationId);
  }

  async findPayments(organizationId: string, invoiceId: string) {
    await this.findOneOrThrow(organizationId, invoiceId);

    return this.prismaService.db.payment.findMany({
      where: { invoice_id: invoiceId, is_deleted: false },
      orderBy: { created_at: 'desc' },
    });
  }

  private async resolveItemPricing(
    items: InvoiceItemInputDto[],
    organizationId: string,
    branchId: string,
    profileId: string,
    defaultCurrency: string,
  ) {
    return Promise.all(
      items.map(async (item) => {
        const quantity = item.quantity ?? 1;
        const discountAmount = new Prisma.Decimal(item.discount_amount ?? 0);
        let unitPrice: Prisma.Decimal;
        let currency = defaultCurrency;
        let pricingSource: PricingSource = PricingSource.CUSTOM;

        if (item.service_id) {
          const resolved = await this.pricingResolver.resolvePrice({
            organizationId,
            branchId,
            serviceId: item.service_id,
            profileId,
          });
          if (resolved) {
            unitPrice = resolved.price;
            currency = resolved.currency;
            pricingSource = resolved.source;
          } else {
            unitPrice = new Prisma.Decimal(item.unit_price);
          }
        } else {
          unitPrice = new Prisma.Decimal(item.unit_price);
        }

        const lineTotal = unitPrice.times(quantity).minus(discountAmount);
        const total_amount = Prisma.Decimal.max(
          new Prisma.Decimal(0),
          lineTotal,
        );

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

  private computeTotals(
    items: { total_amount: Prisma.Decimal | number }[],
    invoiceDiscount: Prisma.Decimal,
    taxAmount: Prisma.Decimal,
  ): { subtotal: Prisma.Decimal; total: Prisma.Decimal } {
    const subtotal = items.reduce(
      (acc, item) => acc.plus(new Prisma.Decimal(item.total_amount.toString())),
      new Prisma.Decimal(0),
    );
    const total = Prisma.Decimal.max(
      new Prisma.Decimal(0),
      subtotal.minus(invoiceDiscount).plus(taxAmount),
    );
    return { subtotal, total };
  }

  private deriveStatus(
    totalAmount: Prisma.Decimal,
    paidAmount: Prisma.Decimal,
  ): InvoiceStatus {
    if (totalAmount.lte(0)) return InvoiceStatus.PAID;
    if (paidAmount.gte(totalAmount)) return InvoiceStatus.PAID;
    if (paidAmount.gt(0)) return InvoiceStatus.PARTIALLY_PAID;
    return InvoiceStatus.ISSUED;
  }

  private assertDraft(invoice: { status: InvoiceStatus; id: string }): void {
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        `Invoice ${invoice.id} is not in DRAFT status and cannot be modified`,
      );
    }
  }

  private async assertIsReceptionistOrOwner(
    user: AuthContext,
    organizationId: string,
  ): Promise<void> {
    if (user.roles.includes('OWNER')) return;

    const match = await this.prismaService.db.profile.findFirst({
      where: {
        id: user.profileId,
        organization_id: organizationId,
        is_deleted: false,
        is_active: true,
        job_functions: {
          some: {
            job_function: { code: 'RECEPTIONIST' },
          },
        },
      },
      select: { id: true },
    });

    if (!match) {
      throw new ForbiddenException('OWNER or RECEPTIONIST role required');
    }
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
