import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { Money } from '../shared/money/money.js';
import { FinancialAccessService } from '../shared/access/financial-access.service.js';
import type { InvoiceItemInputDto } from './dto/create-invoice.dto.js';
import { InvoiceCompositionService } from './invoice-composition.service.js';

/**
 * DRAFT-only invoice line editing: add a single priced item, or remove one.
 * Each mutation recomputes the invoice's subtotal/discount/total and balance in
 * the same transaction. Issued invoices are immutable here — they accrue
 * charges through ChargeAccrualService instead.
 */
@Injectable()
export class InvoiceItemService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly access: FinancialAccessService,
    private readonly composition: InvoiceCompositionService,
  ) {}

  async addItem(
    organizationId: string,
    invoiceId: string,
    dto: InvoiceItemInputDto,
    user: AuthContext,
  ) {
    await this.access.assertIsReceptionistOrOwner(user, organizationId);
    const invoice = await this.composition.findOneOrThrow(
      organizationId,
      invoiceId,
    );
    this.composition.assertDraft(invoice);

    const [resolved] = await this.composition.resolveItemPricing(
      [dto],
      organizationId,
      invoice.branch_id,
      user.profileId,
      invoice.currency,
    );

    return this.prismaService.db.$transaction(async (tx) => {
      await tx.invoiceItem.create({
        data: {
          invoice_id: invoiceId,
          ...this.composition.toItemData(resolved),
        },
      });

      const allItems = await tx.invoiceItem.findMany({
        where: { invoice_id: invoiceId },
      });
      const { subtotal, discountAmount, total } =
        this.composition.computeTotals(
          allItems,
          { type: invoice.discount_type, value: invoice.discount_value },
          invoice.tax_amount,
        );

      return tx.invoice.update({
        where: { id: invoiceId },
        data: {
          subtotal,
          discount_amount: discountAmount,
          total_amount: total,
          balance_due: Money.max(
            Money.zero(),
            Money.subtract(total, invoice.paid_amount),
          ),
        },
        include: { items: true },
      });
    });
  }

  async removeItem(
    organizationId: string,
    invoiceId: string,
    itemId: string,
    user: AuthContext,
  ) {
    await this.access.assertIsReceptionistOrOwner(user, organizationId);
    const invoice = await this.composition.findOneOrThrow(
      organizationId,
      invoiceId,
    );
    this.composition.assertDraft(invoice);

    const item = await this.prismaService.db.invoiceItem.findFirst({
      where: { id: itemId, invoice_id: invoiceId },
    });
    if (!item) throw new NotFoundException('Invoice item not found');

    await this.prismaService.db.$transaction(async (tx) => {
      await tx.invoiceItem.delete({ where: { id: itemId } });

      const remaining = await tx.invoiceItem.findMany({
        where: { invoice_id: invoiceId },
      });
      const { subtotal, discountAmount, total } =
        this.composition.computeTotals(
          remaining,
          { type: invoice.discount_type, value: invoice.discount_value },
          invoice.tax_amount,
        );

      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          subtotal,
          discount_amount: discountAmount,
          total_amount: total,
          balance_due: Money.max(
            Money.zero(),
            Money.subtract(total, invoice.paid_amount),
          ),
        },
      });
    });
  }
}
