import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  FINANCIAL_EVENTS,
  type ChargeCapturedEvent,
} from '../shared/events/financial-events.js';
import { InvoicingService } from './invoicing.service.js';

/**
 * Auto-bills a freshly captured charge onto its case's invoice — appending to an
 * open invoice, or creating and issuing one when the case has none yet (e.g. the
 * service reception picked at booking). So a charge always lands on a bill
 * without reception having to create an invoice and import it. Best-effort and
 * non-blocking: failures are logged, never thrown.
 */
@Injectable()
export class InvoiceAutoAppendListener {
  private readonly logger = new Logger(InvoiceAutoAppendListener.name);

  constructor(private readonly invoicingService: InvoicingService) {}

  @OnEvent(FINANCIAL_EVENTS.charge.captured)
  async handleChargeCaptured(event: ChargeCapturedEvent): Promise<void> {
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
        `Failed to auto-bill charge ${event.charge_id} onto its case invoice`,
        err,
      );
    }
  }
}
