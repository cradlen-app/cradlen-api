import { BadRequestException, Injectable } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { FinancialAccessService } from '../shared/access/financial-access.service.js';
import {
  FINANCIAL_EVENTS,
  type InvoiceIssuedEvent,
} from '../shared/events/financial-events.js';
import { InvoiceCompositionService } from './invoice-composition.service.js';

/**
 * Invoice lifecycle transitions: DRAFT → ISSUED, and the DRAFT/ISSUED → VOID
 * cancel. Owns the issue/void state changes and their domain events; balance
 * transitions (paid/partially-paid) live in InvoiceBalanceService, driven by
 * payments and refunds.
 */
@Injectable()
export class InvoiceLifecycleService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly access: FinancialAccessService,
    private readonly composition: InvoiceCompositionService,
    private readonly eventBus: EventBus,
  ) {}

  async issue(organizationId: string, invoiceId: string, user: AuthContext) {
    await this.access.assertIsReceptionistOrOwner(user, organizationId);
    return this.issueSystem(organizationId, invoiceId, user.profileId);
  }

  /**
   * Core of {@link issue} without the user/role assertion — shared by the public
   * method (after auth) and the event-driven auto-bill path, which has no
   * AuthContext. `actorId` stamps `issued_by_id`.
   */
  async issueSystem(
    organizationId: string,
    invoiceId: string,
    actorId: string,
  ) {
    const invoice = await this.composition.findOneOrThrow(
      organizationId,
      invoiceId,
    );
    this.composition.assertDraft(invoice);

    const itemCount = await this.prismaService.db.invoiceItem.count({
      where: { invoice_id: invoiceId },
    });
    if (itemCount === 0) {
      throw new BadRequestException('Cannot issue an invoice with no items');
    }

    const issued = await this.prismaService.db.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.ISSUED, issued_at: new Date() },
    });

    this.eventBus.publish<InvoiceIssuedEvent>(FINANCIAL_EVENTS.invoice.issued, {
      invoice_id: issued.id,
      invoice_number: issued.invoice_number,
      organization_id: issued.organization_id,
      branch_id: issued.branch_id,
      patient_id: issued.patient_id,
      total_amount: issued.total_amount,
      issued_by_id: actorId,
    });
    return issued;
  }

  async void(organizationId: string, invoiceId: string, user: AuthContext) {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      organizationId,
    );
    const invoice = await this.composition.findOneOrThrow(
      organizationId,
      invoiceId,
    );

    if (
      invoice.status !== InvoiceStatus.DRAFT &&
      invoice.status !== InvoiceStatus.ISSUED
    ) {
      throw new BadRequestException(
        'Only DRAFT or ISSUED invoices can be voided',
      );
    }

    const voided = await this.prismaService.db.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.VOID },
    });
    this.eventBus.publish(FINANCIAL_EVENTS.invoice.voided, {
      invoice_id: voided.id,
      organization_id: organizationId,
    });
    return voided;
  }
}
