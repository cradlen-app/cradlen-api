import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
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
    await this.access.assertCanRunBillingAction(user, organizationId);
    // Branch-scope the transition to the invoice's branch (owners pass org-wide).
    const invoice = await this.composition.findOneOrThrow(
      organizationId,
      invoiceId,
    );
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      organizationId,
      invoice.branch_id,
    );
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
    // Friendly 404 / early DRAFT validation; the authoritative gate is the
    // conditional update below, which closes the issue/void TOCTOU race.
    const invoice = await this.composition.findOneOrThrow(
      organizationId,
      invoiceId,
    );
    this.composition.assertDraft(invoice);

    // Count + status-guarded transition in one transaction so a concurrent item
    // removal can't leave the invoice ISSUED with zero items, and a concurrent
    // issue/void can't double-transition.
    const issued = await this.prismaService.db.$transaction(async (tx) => {
      const itemCount = await tx.invoiceItem.count({
        where: { invoice_id: invoiceId },
      });
      if (itemCount === 0) {
        throw new BadRequestException('Cannot issue an invoice with no items');
      }

      const { count } = await tx.invoice.updateMany({
        where: { id: invoiceId, status: InvoiceStatus.DRAFT },
        data: { status: InvoiceStatus.ISSUED, issued_at: new Date() },
      });
      if (count !== 1) {
        throw new ConflictException(
          'Invoice is no longer in DRAFT status and cannot be issued',
        );
      }
      return tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
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

    // Status-guarded transition: the conditional updateMany is atomic, so a
    // concurrent issue/void/payment can't race this into an invalid transition.
    const { count } = await this.prismaService.db.invoice.updateMany({
      where: {
        id: invoiceId,
        status: { in: [InvoiceStatus.DRAFT, InvoiceStatus.ISSUED] },
      },
      data: { status: InvoiceStatus.VOID },
    });
    if (count !== 1) {
      throw new ConflictException(
        'Invoice can no longer be voided (its status changed)',
      );
    }
    const voided = await this.prismaService.db.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
    });
    this.eventBus.publish(FINANCIAL_EVENTS.invoice.voided, {
      invoice_id: voided.id,
      organization_id: organizationId,
    });
    return voided;
  }
}
