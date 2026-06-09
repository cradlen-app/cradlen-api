import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  FINANCIAL_EVENTS,
  type PaymentRecordedEvent,
  type PaymentVoidedEvent,
} from '../shared/events/financial-events.js';
import { ReceiptsService } from './receipts.service.js';

/**
 * Auto-issues a proof-of-payment receipt whenever a payment is recorded, and
 * voids it when the payment is voided. Cross-module side effect handled via the
 * EventBus pattern — failures are logged, never thrown (the payment already
 * committed; the receipt can be reconciled).
 */
@Injectable()
export class ReceiptsListener {
  private readonly logger = new Logger(ReceiptsListener.name);

  constructor(private readonly receiptsService: ReceiptsService) {}

  @OnEvent(FINANCIAL_EVENTS.payment.recorded)
  async handlePaymentRecorded(event: PaymentRecordedEvent) {
    try {
      await this.receiptsService.issueForPayment(event);
    } catch (err) {
      this.logger.error(
        `Failed to issue receipt for payment ${event.payment_id}`,
        err,
      );
    }
  }

  @OnEvent(FINANCIAL_EVENTS.payment.voided)
  async handlePaymentVoided(event: PaymentVoidedEvent) {
    try {
      await this.receiptsService.voidForPayment(event);
    } catch (err) {
      this.logger.error(
        `Failed to void receipt for payment ${event.payment_id}`,
        err,
      );
    }
  }
}
