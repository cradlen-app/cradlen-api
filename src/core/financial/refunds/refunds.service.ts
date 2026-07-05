import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentStatus, RefundStatus } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { FinancialAccessService } from '../shared/access/financial-access.service.js';
import { InvoiceBalanceService } from '../invoicing/invoice-balance.service.js';
import { Money } from '../shared/money/money.js';
import {
  FINANCIAL_EVENTS,
  type RefundIssuedEvent,
  type RefundVoidedEvent,
} from '../shared/events/financial-events.js';
import type { CreateRefundDto } from './dto/create-refund.dto.js';

/**
 * Refunds reverse part or all of a COMPLETED payment. Issuing one recomputes
 * the owning invoice's balance (a fully reversed payment leaves the invoice
 * REFUNDED). A payment can never be refunded beyond its own amount.
 */
@Injectable()
export class RefundsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly access: FinancialAccessService,
    private readonly balanceService: InvoiceBalanceService,
    private readonly eventBus: EventBus,
  ) {}

  async create(
    organizationId: string,
    dto: CreateRefundDto,
    user: AuthContext,
  ) {
    const payment = await this.prismaService.db.payment.findFirst({
      where: {
        id: dto.payment_id,
        is_deleted: false,
        invoice: { organization_id: organizationId, is_deleted: false },
      },
      include: {
        invoice: { select: { id: true, branch_id: true } },
        refunds: {
          where: { status: RefundStatus.COMPLETED, is_deleted: false },
          select: { amount: true },
        },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      organizationId,
      payment.invoice.branch_id,
    );

    // Refunds pay cash back out, so the cashier must hold an open drawer at the
    // invoice's branch — same precondition as recording a payment.
    const openSession = await this.access.findOpenCashSession(
      organizationId,
      payment.invoice.branch_id,
      user.profileId,
    );
    if (!openSession) {
      throw new BadRequestException(
        'Open a cash session at this branch before issuing a refund',
      );
    }

    if (payment.status !== PaymentStatus.COMPLETED) {
      throw new BadRequestException('Only completed payments can be refunded');
    }

    const alreadyRefunded = Money.sum(payment.refunds.map((r) => r.amount));
    const refundable = Money.subtract(payment.amount, alreadyRefunded);
    if (Money.compare(dto.amount, refundable) > 0) {
      throw new BadRequestException(
        `Refund exceeds the refundable amount (${Money.format(refundable)})`,
      );
    }

    const refund = await this.prismaService.db.$transaction(async (tx) => {
      const created = await tx.refund.create({
        data: {
          payment_id: dto.payment_id,
          amount: Money.of(dto.amount),
          reason: dto.reason,
          status: RefundStatus.COMPLETED,
          refunded_by_id: user.profileId,
        },
      });
      await this.balanceService.recompute(tx, payment.invoice.id);
      return created;
    });

    this.eventBus.publish<RefundIssuedEvent>(FINANCIAL_EVENTS.refund.issued, {
      refund_id: refund.id,
      payment_id: dto.payment_id,
      invoice_id: payment.invoice.id,
      organization_id: organizationId,
      amount: refund.amount,
      refunded_by_id: user.profileId,
    });

    return refund;
  }

  /**
   * Reverse a refund issued in error. The refund drops out of the COMPLETED
   * filter, so recomputing restores the invoice's paid_amount / balance_due /
   * status (e.g. a REFUNDED invoice returns to PAID or PARTIALLY_PAID).
   */
  async voidRefund(
    organizationId: string,
    refundId: string,
    user: AuthContext,
  ) {
    const refund = await this.prismaService.db.refund.findFirst({
      where: {
        id: refundId,
        is_deleted: false,
        payment: { invoice: { organization_id: organizationId } },
      },
      include: {
        payment: {
          select: { invoice: { select: { id: true, branch_id: true } } },
        },
      },
    });
    if (!refund) throw new NotFoundException('Refund not found');

    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      organizationId,
      refund.payment.invoice.branch_id,
    );

    if (refund.status === RefundStatus.VOID) {
      throw new BadRequestException('Refund is already void');
    }
    if (refund.status !== RefundStatus.COMPLETED) {
      throw new BadRequestException('Only completed refunds can be voided');
    }

    const voided = await this.prismaService.db.$transaction(async (tx) => {
      const updated = await tx.refund.update({
        where: { id: refundId },
        data: { status: RefundStatus.VOID },
      });
      await this.balanceService.recompute(tx, refund.payment.invoice.id);
      return updated;
    });

    this.eventBus.publish<RefundVoidedEvent>(FINANCIAL_EVENTS.refund.voided, {
      refund_id: refundId,
      payment_id: refund.payment_id,
      invoice_id: refund.payment.invoice.id,
      organization_id: organizationId,
    });

    return voided;
  }

  async getRefund(organizationId: string, refundId: string, user: AuthContext) {
    const refund = await this.prismaService.db.refund.findFirst({
      where: {
        id: refundId,
        is_deleted: false,
        payment: { invoice: { organization_id: organizationId } },
      },
      include: {
        payment: { select: { invoice: { select: { branch_id: true } } } },
      },
    });
    if (!refund) throw new NotFoundException('Refund not found');
    const { payment, ...rest } = refund;
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      organizationId,
      payment.invoice.branch_id,
    );
    return rest;
  }

  async listForInvoice(
    organizationId: string,
    invoiceId: string,
    user: AuthContext,
  ) {
    const invoice = await this.prismaService.db.invoice.findFirst({
      where: {
        id: invoiceId,
        organization_id: organizationId,
        is_deleted: false,
      },
      select: { branch_id: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      organizationId,
      invoice.branch_id,
    );

    return this.prismaService.db.refund.findMany({
      where: { is_deleted: false, payment: { invoice_id: invoiceId } },
      orderBy: { created_at: 'desc' },
    });
  }
}
