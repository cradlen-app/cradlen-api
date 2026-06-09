import { Injectable } from '@nestjs/common';
import {
  InvoiceStatus,
  PaymentStatus,
  RefundStatus,
  Prisma,
} from '@prisma/client';
import { Money } from '../shared/money/money.js';

/**
 * Recomputes an invoice's paid amount and lifecycle status from its completed
 * payments. Shared by the payments and refunds modules, which call
 * {@link recompute} inside their own transaction so the money movement and the
 * invoice status stay atomic.
 */
@Injectable()
export class InvoiceBalanceService {
  async recompute(tx: Prisma.TransactionClient, invoiceId: string) {
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { total_amount: true },
    });

    const [payments, refunds] = await Promise.all([
      tx.payment.findMany({
        where: {
          invoice_id: invoiceId,
          is_deleted: false,
          status: PaymentStatus.COMPLETED,
        },
        select: { amount: true },
      }),
      tx.refund.findMany({
        where: {
          status: RefundStatus.COMPLETED,
          is_deleted: false,
          payment: { invoice_id: invoiceId },
        },
        select: { amount: true },
      }),
    ]);

    const grossPaid = Money.sum(payments.map((p) => p.amount));
    const refundedTotal = Money.sum(refunds.map((r) => r.amount));
    const paidAmount = Prisma.Decimal.max(
      Money.zero(),
      Money.subtract(grossPaid, refundedTotal),
    );

    let status = InvoiceBalanceService.deriveStatus(
      invoice.total_amount,
      paidAmount,
    );
    // A payment that has been fully reversed leaves the invoice REFUNDED
    // rather than back at ISSUED.
    if (Money.isPositive(refundedTotal) && Money.isZero(paidAmount)) {
      status = InvoiceStatus.REFUNDED;
    }

    const balanceDue = Prisma.Decimal.max(
      Money.zero(),
      Money.subtract(invoice.total_amount, paidAmount),
    );

    return tx.invoice.update({
      where: { id: invoiceId },
      data: { paid_amount: paidAmount, balance_due: balanceDue, status },
    });
  }

  /** Pure status derivation from total vs. paid. */
  static deriveStatus(
    totalAmount: Prisma.Decimal,
    paidAmount: Prisma.Decimal,
  ): InvoiceStatus {
    if (totalAmount.lte(0)) return InvoiceStatus.PAID;
    if (paidAmount.gte(totalAmount)) return InvoiceStatus.PAID;
    if (paidAmount.gt(0)) return InvoiceStatus.PARTIALLY_PAID;
    return InvoiceStatus.ISSUED;
  }
}
