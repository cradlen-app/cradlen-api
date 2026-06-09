/**
 * Public boundary for the financial layer.
 *
 * Other core modules (notifications, reporting consumers, etc.) and the
 * financial sub-modules themselves consume the shared kernel — money helpers,
 * the currency default, and the domain-events catalog — through this barrel,
 * never by reaching into `shared/` internals.
 */

export { Money, type DecimalInput } from './shared/money/money.js';
export { DEFAULT_CURRENCY } from './shared/currency.js';
export {
  FINANCIAL_EVENTS,
  type ChargeCapturedEvent,
  type InvoiceIssuedEvent,
  type InvoiceStatusChangedEvent,
  type PaymentRecordedEvent,
  type RefundIssuedEvent,
  type CashSessionClosedEvent,
} from './shared/events/financial-events.js';
