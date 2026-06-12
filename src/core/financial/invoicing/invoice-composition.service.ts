import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DiscountType,
  InvoiceStatus,
  PricingSource,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { PricingResolverService } from '../pricing/pricing-resolver.service.js';
import { Money } from '../shared/money/money.js';
import type { InvoiceItemInputDto } from './dto/create-invoice.dto.js';

/** A priced invoice line, ready to persist (the shape `toItemData` flattens). */
export interface ResolvedItem {
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
export interface InvoiceDiscountInput {
  type: DiscountType | null;
  value: Prisma.Decimal | null;
}

/**
 * Shared invoice-assembly helpers — pricing resolution, line/total math, episode
 * resolution and the scoped single-invoice read. Stateless apart from its two
 * read dependencies; every invoicing collaborator (CRUD, accrual, items,
 * lifecycle) composes invoices through this one place so the math lives once.
 */
@Injectable()
export class InvoiceCompositionService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly pricingResolver: PricingResolverService,
  ) {}

  /** Flatten a resolved line into the InvoiceItem create payload. */
  toItemData(item: ResolvedItem) {
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

  async resolveItemPricing(
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
        const total_amount = Money.max(Money.zero(), lineTotal);

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

  discountFromDto(type?: DiscountType, value?: number): InvoiceDiscountInput {
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
  resolveInvoiceDiscount(
    subtotal: Prisma.Decimal,
    discount: InvoiceDiscountInput,
  ): Prisma.Decimal {
    if (discount.type === null || discount.value === null) return Money.zero();
    const amount =
      discount.type === DiscountType.PERCENTAGE
        ? Money.round(
            Money.divide(Money.multiply(subtotal, discount.value), 100),
          )
        : discount.value;
    return Money.clamp(amount, Money.zero(), subtotal);
  }

  computeTotals(
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
    const total = Money.max(
      Money.zero(),
      Money.add(Money.subtract(subtotal, discountAmount), taxAmount),
    );
    return { subtotal, discountAmount, total };
  }

  assertDraft(invoice: { status: InvoiceStatus; id: string }): void {
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
  async resolveEpisodeId(
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
  endOfDay(date: string): Date {
    const end = new Date(date);
    end.setUTCHours(23, 59, 59, 999);
    return end;
  }

  /** Org-scoped single-invoice read; throws 404 when not found in this org. */
  async findOneOrThrow(organizationId: string, invoiceId: string) {
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
