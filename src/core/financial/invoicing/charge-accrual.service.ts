import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChargeSource,
  ChargeStatus,
  InvoiceStatus,
  InvoiceType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { PricingResolverService } from '../pricing/pricing-resolver.service.js';
import { Money } from '../shared/money/money.js';
import { FinancialAccessService } from '../shared/access/financial-access.service.js';
import { FINANCIAL_EVENTS } from '../shared/events/financial-events.js';
import { InvoiceNumberService } from './invoice-number.service.js';
import { InvoiceBalanceService } from './invoice-balance.service.js';
import {
  InvoiceCompositionService,
  type ResolvedItem,
} from './invoice-composition.service.js';
import { InvoiceLifecycleService } from './invoice-lifecycle.service.js';
import type { BuildInvoiceFromChargesDto } from './dto/build-invoice-from-charges.dto.js';
import type { AppendChargesDto } from './dto/append-charges.dto.js';

/**
 * Charge → invoice accrual: the family of paths that turn captured PENDING
 * charges into invoice lines. Builds a fresh invoice from charges, appends to an
 * issued one, tops up a draft, the event-driven auto-bill router
 * ({@link ensureInvoiceForCharge}), and the booking-service swap. Each flips the
 * source charges to INVOICED inside the same transaction as the invoice write.
 */
@Injectable()
export class ChargeAccrualService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly access: FinancialAccessService,
    private readonly pricingResolver: PricingResolverService,
    private readonly invoiceNumberService: InvoiceNumberService,
    private readonly balanceService: InvoiceBalanceService,
    private readonly composition: InvoiceCompositionService,
    private readonly lifecycle: InvoiceLifecycleService,
    private readonly eventBus: EventBus,
  ) {}

  /**
   * Assemble a DRAFT invoice from a patient's open charges: each PENDING charge
   * becomes an invoice line (linked via charge_id) and flips to INVOICED.
   */
  async buildFromCharges(
    organizationId: string,
    dto: BuildInvoiceFromChargesDto,
    user: AuthContext,
  ) {
    await this.access.assertCanRunBillingAction(user, organizationId);
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      organizationId,
      dto.branch_id,
    );
    return this.buildFromChargesSystem(organizationId, dto, user.profileId);
  }

  /**
   * Core of {@link buildFromCharges} without the user/role assertion — shared by
   * the public method (after auth) and the event-driven auto-bill path, which
   * has no AuthContext. `actorId` stamps `created_by_id`.
   */
  async buildFromChargesSystem(
    organizationId: string,
    dto: BuildInvoiceFromChargesDto,
    actorId: string,
  ) {
    const invoiceNumber =
      await this.invoiceNumberService.generate(organizationId);

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

      const discount = this.composition.discountFromDto(
        dto.discount_type,
        dto.discount_value,
      );
      const { subtotal, discountAmount, total } =
        this.composition.computeTotals(items, discount, Money.zero());

      const created = await tx.invoice.create({
        data: {
          invoice_number: invoiceNumber,
          invoice_type: dto.invoice_type ?? InvoiceType.STANDARD,
          organization_id: organizationId,
          branch_id: dto.branch_id,
          patient_id: dto.patient_id,
          visit_id: dto.visit_id,
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
          created_by_id: actorId,
          items: {
            create: items.map((item) => this.composition.toItemData(item)),
          },
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
    await this.access.assertCanRunBillingAction(user, organizationId);
    return this.appendChargesSystem(organizationId, invoiceId, dto.charge_ids);
  }

  /**
   * Core append logic without the user/role assertion — shared by the public
   * {@link appendCharges} (after auth) and the auto-append event path. Pass
   * `throwIfEmpty: false` for best-effort callers (the listener) so a charge
   * that's already invoiced is a quiet no-op instead of an error.
   */
  async appendChargesSystem(
    organizationId: string,
    invoiceId: string,
    chargeIds?: string[],
    opts: { throwIfEmpty?: boolean } = {},
  ) {
    const { throwIfEmpty = true } = opts;
    const invoice = await this.composition.findOneOrThrow(
      organizationId,
      invoiceId,
    );

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
          ...(chargeIds?.length && { id: { in: chargeIds } }),
        },
        orderBy: { captured_at: 'asc' },
      });

      if (charges.length === 0) {
        if (!throwIfEmpty) {
          return tx.invoice.findUniqueOrThrow({
            where: { id: invoiceId },
            include: { items: true },
          });
        }
        throw new BadRequestException('No open charges to append');
      }

      await tx.invoiceItem.createMany({
        data: charges.map((charge) => ({
          invoice_id: invoiceId,
          ...this.composition.toItemData({
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
      const { subtotal, discountAmount, total } =
        this.composition.computeTotals(
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

  /**
   * Add open (PENDING) charges to an existing DRAFT invoice, keeping it DRAFT.
   * Mirrors {@link appendChargesSystem} but for a not-yet-issued invoice: totals
   * are recomputed directly (balance_due = total) rather than via the payment
   * balance recompute, which would derive a status and flip DRAFT → ISSUED.
   * Best-effort: a no-op (returns the unchanged invoice) when nothing's pending.
   */
  async addChargesToDraftSystem(
    organizationId: string,
    invoiceId: string,
    chargeIds?: string[],
  ) {
    const invoice = await this.composition.findOneOrThrow(
      organizationId,
      invoiceId,
    );
    this.composition.assertDraft(invoice);

    return this.prismaService.db.$transaction(async (tx) => {
      const charges = await tx.charge.findMany({
        where: {
          organization_id: organizationId,
          branch_id: invoice.branch_id,
          patient_id: invoice.patient_id,
          status: ChargeStatus.PENDING,
          is_deleted: false,
          ...(chargeIds?.length && { id: { in: chargeIds } }),
        },
        orderBy: { captured_at: 'asc' },
      });

      if (charges.length === 0) {
        return tx.invoice.findUniqueOrThrow({
          where: { id: invoiceId },
          include: { items: true },
        });
      }

      await tx.invoiceItem.createMany({
        data: charges.map((charge) => ({
          invoice_id: invoiceId,
          ...this.composition.toItemData({
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

      const allItems = await tx.invoiceItem.findMany({
        where: { invoice_id: invoiceId },
      });
      const { subtotal, discountAmount, total } =
        this.composition.computeTotals(
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
          balance_due: total,
        },
        include: { items: true },
      });
    });
  }

  /**
   * Ensure a captured charge lands on its visit's invoice — the event-driven
   * auto-bill path that enforces one open invoice per visit (encounter):
   *   • an ISSUED / PARTIALLY_PAID / PAID invoice exists → append to it (so a
   *     service the doctor adds mid-visit lands on the same visit's bill);
   *   • a DRAFT exists → add the charge to that draft, which stays DRAFT (a
   *     human started it intentionally);
   *   • none exists → build a fresh invoice from the charge and issue it, so the
   *     fee is ready to collect without a manual create/pull step (e.g. the
   *     service reception picked at booking).
   * Billing is per-visit, so a returning patient's next visit gets its own
   * invoice. Best-effort: a no-op when the charge has no visit.
   */
  async ensureInvoiceForCharge(event: {
    organization_id: string;
    branch_id: string;
    patient_id: string;
    visit_id: string | null;
    charge_id: string;
    captured_by_id: string;
  }): Promise<void> {
    if (!event.visit_id) return;

    const openInvoice = await this.prismaService.db.invoice.findFirst({
      where: {
        organization_id: event.organization_id,
        branch_id: event.branch_id,
        visit_id: event.visit_id,
        is_deleted: false,
        status: {
          in: [
            InvoiceStatus.DRAFT,
            InvoiceStatus.ISSUED,
            InvoiceStatus.PARTIALLY_PAID,
            InvoiceStatus.PAID,
          ],
        },
      },
      orderBy: { created_at: 'desc' },
      select: { id: true, status: true },
    });

    if (openInvoice?.status === InvoiceStatus.DRAFT) {
      await this.addChargesToDraftSystem(
        event.organization_id,
        openInvoice.id,
        [event.charge_id],
      );
      return;
    }

    if (openInvoice) {
      await this.appendChargesSystem(
        event.organization_id,
        openInvoice.id,
        [event.charge_id],
        { throwIfEmpty: false },
      );
      return;
    }

    // No invoice for this case yet → create one from the charge and issue it.
    const invoice = await this.buildFromChargesSystem(
      event.organization_id,
      {
        branch_id: event.branch_id,
        patient_id: event.patient_id,
        visit_id: event.visit_id,
        charge_ids: [event.charge_id],
      },
      event.captured_by_id,
    );
    await this.lifecycle.issueSystem(
      event.organization_id,
      invoice.id,
      event.captured_by_id,
    );
  }

  /**
   * Swap the service captured at booking for a visit, applied to billing only
   * while the case invoice is still unpaid. Finds the visit's booking charge
   * (earliest service-bearing, still-eligible charge), voids it and removes its
   * invoice line, then captures a new INVOICED charge for `newServiceId` (priced
   * for the assigned doctor) and re-bills it onto the same invoice, recomputing
   * totals.
   *
   * No-op when the visit has no booking charge (legacy) or the service is
   * unchanged. Throws `BadRequestException` when a payment has already been
   * recorded on the invoice (the unpaid guard) or no price resolves for the new
   * service. The whole swap runs in one transaction, so a guard failure rolls back.
   */
  async swapVisitBookingService(params: {
    organizationId: string;
    visitId: string;
    newServiceId: string;
    /** Final assigned doctor — the charge is priced for, and attributed to, them. */
    profileId: string;
    branchId: string;
    capturedById: string;
  }): Promise<void> {
    const {
      organizationId,
      visitId,
      newServiceId,
      profileId,
      branchId,
      capturedById,
    } = params;

    // Booking charge: earliest service-bearing, non-deleted charge for the visit
    // still eligible to swap (PENDING, or already INVOICED onto the case invoice).
    const oldCharge = await this.prismaService.db.charge.findFirst({
      where: {
        organization_id: organizationId,
        visit_id: visitId,
        is_deleted: false,
        service_id: { not: null },
        status: { in: [ChargeStatus.PENDING, ChargeStatus.INVOICED] },
      },
      orderBy: { captured_at: 'asc' },
    });
    if (!oldCharge) return; // legacy visit with no booking charge — nothing to swap
    if (oldCharge.service_id === newServiceId) return; // unchanged

    // Price the new service for the final assigned doctor.
    const resolved = await this.pricingResolver.resolvePrice({
      organizationId,
      branchId,
      serviceId: newServiceId,
      profileId,
      quantity: oldCharge.quantity,
    });
    if (!resolved) {
      throw new BadRequestException(
        'No price could be resolved for the selected service.',
      );
    }
    const service = await this.prismaService.db.service.findFirst({
      where: {
        id: newServiceId,
        OR: [{ organization_id: organizationId }, { organization_id: null }],
        is_deleted: false,
      },
      select: { name: true },
    });
    if (!service) throw new NotFoundException('Service not found');

    const quantity = oldCharge.quantity;
    const lineTotal = Money.multiply(resolved.price, quantity);

    await this.prismaService.db.$transaction(async (tx) => {
      const oldItem = await tx.invoiceItem.findFirst({
        where: { charge_id: oldCharge.id },
        include: { invoice: true },
      });

      // Unpaid guard — checked before any write so a violation rolls back cleanly.
      if (oldItem) {
        const invoice = oldItem.invoice;
        if (
          Money.isPositive(invoice.paid_amount) ||
          invoice.status === InvoiceStatus.PARTIALLY_PAID ||
          invoice.status === InvoiceStatus.PAID
        ) {
          throw new BadRequestException(
            "Cannot change the service after a payment has been recorded on this visit's invoice.",
          );
        }
      }

      await tx.charge.update({
        where: { id: oldCharge.id },
        data: { status: ChargeStatus.VOID },
      });

      const newCharge = await tx.charge.create({
        data: {
          organization_id: organizationId,
          branch_id: branchId,
          patient_id: oldCharge.patient_id,
          visit_id: visitId,
          profile_id: profileId,
          service_id: newServiceId,
          description: service.name,
          quantity,
          unit_price: resolved.price,
          currency: resolved.currency,
          pricing_source: resolved.source,
          source: ChargeSource.RECEPTION,
          status: oldItem ? ChargeStatus.INVOICED : ChargeStatus.PENDING,
          captured_by_id: capturedById,
        },
      });

      if (!oldItem) return; // old charge was never billed — nothing to recompute

      const invoice = oldItem.invoice;
      await tx.invoiceItem.delete({ where: { id: oldItem.id } });
      await tx.invoiceItem.create({
        data: {
          invoice_id: invoice.id,
          ...this.composition.toItemData({
            service_id: newServiceId,
            charge_id: newCharge.id,
            description: service.name,
            quantity,
            unit_price: resolved.price,
            currency: resolved.currency,
            discount_amount: Money.zero(),
            total_amount: lineTotal,
            pricing_source: resolved.source,
          }),
        },
      });

      const allItems = await tx.invoiceItem.findMany({
        where: { invoice_id: invoice.id },
      });
      const { subtotal, discountAmount, total } =
        this.composition.computeTotals(
          allItems,
          { type: invoice.discount_type, value: invoice.discount_value },
          invoice.tax_amount,
        );
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          subtotal,
          discount_amount: discountAmount,
          total_amount: total,
        },
      });

      if (invoice.status === InvoiceStatus.DRAFT) {
        // Keep a DRAFT in DRAFT — set the balance directly rather than via the
        // payment recompute, which would derive a status and flip DRAFT → ISSUED.
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { balance_due: total },
        });
      } else {
        await this.balanceService.recompute(tx, invoice.id);
      }
    });
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
