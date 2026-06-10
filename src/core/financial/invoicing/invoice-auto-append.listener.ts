import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  FINANCIAL_EVENTS,
  type ChargeCapturedEvent,
} from '../shared/events/financial-events.js';
import { InvoicingService } from './invoicing.service.js';

/**
 * Auto-appends a freshly captured charge to its case's open issued invoice — so
 * a service a doctor adds mid-visit lands on the bill without reception having
 * to import it. Best-effort and non-blocking: failures are logged, never thrown.
 */
@Injectable()
export class InvoiceAutoAppendListener {
  private readonly logger = new Logger(InvoiceAutoAppendListener.name);

  constructor(private readonly invoicingService: InvoicingService) {}

  @OnEvent(FINANCIAL_EVENTS.charge.captured)
  async handleChargeCaptured(event: ChargeCapturedEvent): Promise<void> {
    try {
      await this.invoicingService.autoAppendChargeFromEvent({
        organization_id: event.organization_id,
        branch_id: event.branch_id,
        visit_id: event.visit_id,
        charge_id: event.charge_id,
      });
    } catch (err) {
      this.logger.error(
        `Failed to auto-append charge ${event.charge_id} to its open invoice`,
        err,
      );
    }
  }
}
