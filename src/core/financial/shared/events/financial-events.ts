import {
  Prisma,
  ChargeSource,
  InvoiceStatus,
  PaymentMethod,
  PricingSource,
} from '@prisma/client';

/**
 * Financial domain events catalog.
 *
 * Single source of truth for event names + typed payloads emitted across the
 * revenue-cycle layer (catalog → pricing → charging → invoicing → payments →
 * refunds → cash-management). Consumers subscribe via `@OnEvent('<name>')`.
 *
 * Naming convention: `<entity>.<verb-past-tense>`, lowercase, dot-separated.
 * Publish through `EventBus`; never invent ad-hoc event strings.
 */
export const FINANCIAL_EVENTS = {
  charge: {
    captured: 'charge.captured',
    updated: 'charge.updated',
    voided: 'charge.voided',
    writtenOff: 'charge.written_off',
  },
  invoice: {
    created: 'invoice.created',
    issued: 'invoice.issued',
    voided: 'invoice.voided',
    paid: 'invoice.paid',
  },
  payment: {
    recorded: 'payment.recorded',
    voided: 'payment.voided',
  },
  refund: {
    issued: 'refund.issued',
    voided: 'refund.voided',
  },
  receipt: {
    issued: 'receipt.issued',
    voided: 'receipt.voided',
  },
  cashSession: {
    opened: 'cash_session.opened',
    closed: 'cash_session.closed',
    reconciled: 'cash_session.reconciled',
  },
} as const;

// ---------- Payload contracts (subscribers should rely on these) ----------

export interface ChargeCapturedEvent {
  charge_id: string;
  organization_id: string;
  branch_id: string;
  patient_id: string;
  visit_id: string | null;
  service_id: string | null;
  amount: Prisma.Decimal;
  pricing_source: PricingSource;
  source: ChargeSource;
  captured_by_id: string;
}

export interface ChargeUpdatedEvent {
  charge_id: string;
  organization_id: string;
  quantity: number;
}

export interface InvoiceIssuedEvent {
  invoice_id: string;
  invoice_number: string;
  organization_id: string;
  branch_id: string;
  patient_id: string;
  total_amount: Prisma.Decimal;
  issued_by_id: string;
}

export interface InvoiceStatusChangedEvent {
  invoice_id: string;
  organization_id: string;
  patient_id: string;
  previous_status: InvoiceStatus;
  new_status: InvoiceStatus;
  total_amount: Prisma.Decimal;
  paid_amount: Prisma.Decimal;
}

export interface PaymentRecordedEvent {
  payment_id: string;
  invoice_id: string;
  organization_id: string;
  branch_id: string;
  amount: Prisma.Decimal;
  payment_method: PaymentMethod;
  cash_session_id: string | null;
  recorded_by_id: string;
}

export interface PaymentVoidedEvent {
  payment_id: string;
  invoice_id: string;
  organization_id: string;
}

export interface RefundIssuedEvent {
  refund_id: string;
  payment_id: string;
  invoice_id: string;
  organization_id: string;
  amount: Prisma.Decimal;
  refunded_by_id: string;
}

export interface RefundVoidedEvent {
  refund_id: string;
  payment_id: string;
  invoice_id: string;
  organization_id: string;
}

export interface ReceiptIssuedEvent {
  receipt_id: string;
  receipt_number: string;
  payment_id: string;
  invoice_id: string;
  organization_id: string;
}

export interface CashSessionClosedEvent {
  cash_session_id: string;
  organization_id: string;
  branch_id: string;
  profile_id: string;
  expected_amount: Prisma.Decimal;
  counted_amount: Prisma.Decimal;
  variance: Prisma.Decimal;
  closed_by_id: string;
}
