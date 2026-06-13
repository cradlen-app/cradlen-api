import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  FINANCIAL_EVENTS,
  type ChargeCapturedEvent,
} from '../shared/events/financial-events.js';
import { InvoicingService } from './invoicing.service.js';

/**
 * Auto-bills a captured charge onto its visit (encounter) invoice — creating and
 * issuing one when none exists, or appending to the open invoice otherwise.
 *
 * Cross-module side effect handled via the EventBus pattern (charging no longer
 * depends on invoicing): the charge is already persisted, so a billing gap is
 * logged and reconciled, never thrown back at the captor. The "a visit must
 * never exist without its charge" invariant is enforced upstream in booking's
 * in-transaction capture — invoicing is a downstream convenience.
 */
@Injectable()
export class InvoiceAccrualListener {
  private readonly logger = new Logger(InvoiceAccrualListener.name);

  constructor(private readonly invoicingService: InvoicingService) {}

  @OnEvent(FINANCIAL_EVENTS.charge.captured)
  async handleChargeCaptured(event: ChargeCapturedEvent) {
    try {
      await this.invoicingService.ensureInvoiceForCharge({
        organization_id: event.organization_id,
        branch_id: event.branch_id,
        patient_id: event.patient_id,
        visit_id: event.visit_id,
        charge_id: event.charge_id,
        captured_by_id: event.captured_by_id,
      });
    } catch (err) {
      this.logger.error(
        `Failed to auto-bill charge ${event.charge_id} onto its visit invoice`,
        err as Error,
      );
    }
  }
}
