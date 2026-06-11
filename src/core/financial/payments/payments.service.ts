import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CashSessionStatus,
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
} from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { FinancialAccessService } from '../shared/access/financial-access.service.js';
import { InvoiceBalanceService } from '../invoicing/invoice-balance.service.js';
import { Money } from '../shared/money/money.js';
import {
  FINANCIAL_EVENTS,
  type PaymentRecordedEvent,
} from '../shared/events/financial-events.js';
import type { RecordPaymentDto } from './dto/record-payment.dto.js';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly access: FinancialAccessService,
    private readonly balanceService: InvoiceBalanceService,
    private readonly eventBus: EventBus,
  ) {}

  async recordPayment(
    organizationId: string,
    invoiceId: string,
    dto: RecordPaymentDto,
    user: AuthContext,
  ) {
    await this.access.assertIsReceptionistOrOwner(user, organizationId);
    const invoice = await this.findInvoiceOrThrow(organizationId, invoiceId);

    if (invoice.status === InvoiceStatus.VOID) {
      throw new BadRequestException(
        'Cannot record a payment on a cancelled (void) invoice',
      );
    }
    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Invoice is already fully paid');
    }
    if (
      invoice.status !== InvoiceStatus.ISSUED &&
      invoice.status !== InvoiceStatus.PARTIALLY_PAID
    ) {
      throw new BadRequestException(
        'Payments can only be recorded on ISSUED or PARTIALLY_PAID invoices',
      );
    }

    // Partial payments are allowed; overpaying the outstanding balance is not.
    const outstanding = Money.subtract(
      invoice.total_amount,
      invoice.paid_amount,
    );
    if (Money.compare(Money.of(dto.amount), outstanding) > 0) {
      throw new BadRequestException('Payment exceeds outstanding balance');
    }

    // Every payment requires the cashier to hold an open drawer at the
    // invoice's branch, so collected cash always reconciles. Only cash is
    // attributed to the session — card/transfer/insurance never enter the
    // physical drawer and must not inflate its expected total.
    const openSession = await this.findOpenSessionForUser(
      organizationId,
      invoice.branch_id,
      user.profileId,
    );
    if (!openSession) {
      throw new BadRequestException(
        'Open a cash session at this branch before recording payments',
      );
    }
    const cashSessionId =
      dto.payment_method === PaymentMethod.CASH ? openSession.id : null;

    const { payment, updatedInvoice } =
      await this.prismaService.db.$transaction(async (tx) => {
        const payment = await tx.payment.create({
          data: {
            invoice_id: invoiceId,
            amount: Money.of(dto.amount),
            currency: dto.currency ?? invoice.currency,
            status: PaymentStatus.COMPLETED,
            payment_method: dto.payment_method,
            payment_date: dto.payment_date
              ? new Date(dto.payment_date)
              : new Date(),
            reference_number: dto.reference_number,
            notes: dto.notes,
            recorded_by_id: user.profileId,
            cash_session_id: cashSessionId,
          },
        });
        const updatedInvoice = await this.balanceService.recompute(
          tx,
          invoiceId,
        );
        return { payment, updatedInvoice };
      });

    this.eventBus.publish<PaymentRecordedEvent>(
      FINANCIAL_EVENTS.payment.recorded,
      {
        payment_id: payment.id,
        invoice_id: invoiceId,
        organization_id: organizationId,
        branch_id: invoice.branch_id,
        amount: payment.amount,
        payment_method: payment.payment_method,
        cash_session_id: cashSessionId,
        recorded_by_id: user.profileId,
      },
    );

    if (updatedInvoice.status === InvoiceStatus.PAID) {
      this.eventBus.publish(FINANCIAL_EVENTS.invoice.paid, {
        invoice_id: invoiceId,
        organization_id: organizationId,
        patient_id: invoice.patient_id,
        previous_status: invoice.status,
        new_status: updatedInvoice.status,
        total_amount: updatedInvoice.total_amount,
        paid_amount: updatedInvoice.paid_amount,
      });
    }

    return { payment, invoice: updatedInvoice };
  }

  async getPayment(
    organizationId: string,
    invoiceId: string,
    paymentId: string,
    user: AuthContext,
  ) {
    const invoice = await this.findInvoiceOrThrow(organizationId, invoiceId);
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      organizationId,
      invoice.branch_id,
    );

    const payment = await this.prismaService.db.payment.findFirst({
      where: { id: paymentId, invoice_id: invoiceId, is_deleted: false },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  async findPayments(
    organizationId: string,
    invoiceId: string,
    user: AuthContext,
  ) {
    const invoice = await this.findInvoiceOrThrow(organizationId, invoiceId);
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      organizationId,
      invoice.branch_id,
    );

    return this.prismaService.db.payment.findMany({
      where: { invoice_id: invoiceId, is_deleted: false },
      orderBy: { created_at: 'desc' },
    });
  }

  async voidPayment(
    organizationId: string,
    invoiceId: string,
    paymentId: string,
    user: AuthContext,
  ) {
    const invoice = await this.findInvoiceOrThrow(organizationId, invoiceId);
    await this.authorizationService.assertCanManageBranch(
      user.profileId,
      organizationId,
      invoice.branch_id,
    );

    const payment = await this.prismaService.db.payment.findFirst({
      where: { id: paymentId, invoice_id: invoiceId, is_deleted: false },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === PaymentStatus.VOID) {
      throw new BadRequestException('Payment is already void');
    }

    const { voidedPayment, updatedInvoice } =
      await this.prismaService.db.$transaction(async (tx) => {
        const voidedPayment = await tx.payment.update({
          where: { id: paymentId },
          data: { status: PaymentStatus.VOID },
        });
        const updatedInvoice = await this.balanceService.recompute(
          tx,
          invoiceId,
        );
        return { voidedPayment, updatedInvoice };
      });

    this.eventBus.publish(FINANCIAL_EVENTS.payment.voided, {
      payment_id: paymentId,
      invoice_id: invoiceId,
      organization_id: organizationId,
    });
    return { payment: voidedPayment, invoice: updatedInvoice };
  }

  private async findInvoiceOrThrow(organizationId: string, invoiceId: string) {
    const invoice = await this.prismaService.db.invoice.findFirst({
      where: {
        id: invoiceId,
        organization_id: organizationId,
        is_deleted: false,
      },
      select: {
        id: true,
        status: true,
        currency: true,
        branch_id: true,
        patient_id: true,
        total_amount: true,
        paid_amount: true,
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  /** The recording cashier's own OPEN drawer at the given branch, or null. */
  private async findOpenSessionForUser(
    organizationId: string,
    branchId: string,
    profileId: string,
  ): Promise<{ id: string } | null> {
    return this.prismaService.db.cashSession.findFirst({
      where: {
        organization_id: organizationId,
        branch_id: branchId,
        profile_id: profileId,
        status: CashSessionStatus.OPEN,
        is_deleted: false,
      },
      select: { id: true },
    });
  }
}
