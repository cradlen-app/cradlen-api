import { Injectable, NotFoundException } from '@nestjs/common';
import { ReceiptStatus } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import {
  FINANCIAL_EVENTS,
  type PaymentRecordedEvent,
  type PaymentVoidedEvent,
  type ReceiptIssuedEvent,
} from '../shared/events/financial-events.js';
import { ReceiptNumberService } from './receipt-number.service.js';
import type { ReceiptPrintDto } from './dto/receipt-print.dto.js';

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly receiptNumberService: ReceiptNumberService,
    private readonly eventBus: EventBus,
  ) {}

  /**
   * Issue the proof-of-payment receipt for a recorded payment. Internal (no
   * auth gate) — the originating payment action was already authorized. Called
   * by ReceiptsListener on `payment.recorded`. Idempotent: one receipt per
   * payment (also DB-guarded by the unique payment_id index).
   */
  async issueForPayment(event: PaymentRecordedEvent) {
    const existing = await this.prismaService.db.receipt.findUnique({
      where: { payment_id: event.payment_id },
      select: { id: true },
    });
    if (existing) return existing;

    const invoice = await this.prismaService.db.invoice.findUniqueOrThrow({
      where: { id: event.invoice_id },
      select: { patient_id: true, currency: true, balance_due: true },
    });

    const receiptNumber = await this.receiptNumberService.generate(
      event.organization_id,
    );

    const receipt = await this.prismaService.db.receipt.create({
      data: {
        receipt_number: receiptNumber,
        organization_id: event.organization_id,
        branch_id: event.branch_id,
        patient_id: invoice.patient_id,
        invoice_id: event.invoice_id,
        payment_id: event.payment_id,
        amount: event.amount,
        currency: invoice.currency,
        payment_method: event.payment_method,
        balance_after: invoice.balance_due,
        issued_by_id: event.recorded_by_id,
      },
    });

    this.eventBus.publish<ReceiptIssuedEvent>(FINANCIAL_EVENTS.receipt.issued, {
      receipt_id: receipt.id,
      receipt_number: receipt.receipt_number,
      payment_id: receipt.payment_id,
      invoice_id: receipt.invoice_id,
      organization_id: receipt.organization_id,
    });

    return receipt;
  }

  /** Void the receipt for a voided payment. Internal (no auth gate). */
  async voidForPayment(event: PaymentVoidedEvent) {
    const receipt = await this.prismaService.db.receipt.findUnique({
      where: { payment_id: event.payment_id },
      select: { id: true, status: true },
    });
    if (!receipt || receipt.status === ReceiptStatus.VOID) return;

    await this.prismaService.db.receipt.update({
      where: { id: receipt.id },
      data: { status: ReceiptStatus.VOID },
    });

    this.eventBus.publish(FINANCIAL_EVENTS.receipt.voided, {
      receipt_id: receipt.id,
      payment_id: event.payment_id,
      invoice_id: event.invoice_id,
      organization_id: event.organization_id,
    });
  }

  async getReceipt(
    organizationId: string,
    receiptId: string,
    user: AuthContext,
  ) {
    const receipt = await this.prismaService.db.receipt.findFirst({
      where: {
        id: receiptId,
        organization_id: organizationId,
        is_deleted: false,
      },
    });
    if (!receipt) throw new NotFoundException('Receipt not found');
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      organizationId,
      receipt.branch_id,
    );
    return receipt;
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

    return this.prismaService.db.receipt.findMany({
      where: { invoice_id: invoiceId, is_deleted: false },
      orderBy: { issued_at: 'desc' },
    });
  }

  /** Printable aggregate for a single receipt. */
  async print(
    organizationId: string,
    receiptId: string,
    user: AuthContext,
  ): Promise<ReceiptPrintDto> {
    const receipt = await this.prismaService.db.receipt.findFirst({
      where: {
        id: receiptId,
        organization_id: organizationId,
        is_deleted: false,
      },
      include: {
        organization: {
          select: { id: true, name: true, logo_object_key: true },
        },
        branch: {
          select: {
            id: true,
            name: true,
            address: true,
            city: true,
            governorate: true,
          },
        },
        patient: {
          select: { id: true, full_name: true, phone_number: true },
        },
        invoice: {
          select: { id: true, invoice_number: true, total_amount: true },
        },
        payment: {
          select: {
            id: true,
            amount: true,
            payment_method: true,
            payment_date: true,
          },
        },
        issued_by: {
          select: {
            id: true,
            user: { select: { first_name: true, last_name: true } },
          },
        },
      },
    });
    if (!receipt) throw new NotFoundException('Receipt not found');
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      organizationId,
      receipt.branch_id,
    );

    return {
      receipt_number: receipt.receipt_number,
      issued_at: receipt.issued_at,
      status: receipt.status,
      currency: receipt.currency,
      balance_after: receipt.balance_after.toFixed(2),
      organization: {
        id: receipt.organization.id,
        name: receipt.organization.name,
        logo_object_key: receipt.organization.logo_object_key,
      },
      branch: {
        id: receipt.branch.id,
        name: receipt.branch.name,
        address: receipt.branch.address,
        city: receipt.branch.city,
        governorate: receipt.branch.governorate,
      },
      patient: {
        id: receipt.patient.id,
        full_name: receipt.patient.full_name,
        phone_number: receipt.patient.phone_number,
      },
      invoice: {
        id: receipt.invoice.id,
        invoice_number: receipt.invoice.invoice_number,
        total_amount: receipt.invoice.total_amount.toFixed(2),
      },
      payment: {
        id: receipt.payment.id,
        amount: receipt.payment.amount.toFixed(2),
        payment_method: receipt.payment.payment_method,
        payment_date: receipt.payment.payment_date,
      },
      issued_by: {
        id: receipt.issued_by.id,
        name: `${receipt.issued_by.user.first_name} ${receipt.issued_by.user.last_name}`,
      },
    };
  }
}
