import { BadRequestException, ConflictException } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { InvoiceLifecycleService } from './invoice-lifecycle.service.js';

const d = (n: number) => new Prisma.Decimal(n);

/**
 * Builds the service with hand-mocked collaborators. `invoice` is the row
 * findOneOrThrow returns; `itemCount` and `updateCount` drive the in-tx guards.
 */
const build = (opts: {
  invoice: { id: string; status: InvoiceStatus };
  itemCount?: number;
  updateCount?: number;
}) => {
  const issuedRow = {
    id: opts.invoice.id,
    invoice_number: 'INV-2026-00001',
    organization_id: 'org-1',
    branch_id: 'br-1',
    patient_id: 'pat-1',
    total_amount: d(100),
    status: InvoiceStatus.ISSUED,
  };

  const updateMany = jest
    .fn()
    .mockResolvedValue({ count: opts.updateCount ?? 1 });
  const findUniqueOrThrow = jest.fn().mockResolvedValue(issuedRow);
  const count = jest.fn().mockResolvedValue(opts.itemCount ?? 1);

  const tx = {
    invoiceItem: { count },
    invoice: { updateMany, findUniqueOrThrow },
  };

  const prismaService = {
    db: {
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
      invoice: { updateMany, findUniqueOrThrow },
    },
  };

  const authorizationService = {
    assertCanManageOrganization: jest.fn().mockResolvedValue(undefined),
    assertCanAccessBranch: jest.fn().mockResolvedValue(undefined),
  };
  const access = {
    assertCanRunBillingAction: jest.fn().mockResolvedValue(undefined),
  };
  const composition = {
    findOneOrThrow: jest.fn().mockResolvedValue(opts.invoice),
    assertDraft: jest.fn((inv: { status: InvoiceStatus; id: string }) => {
      if (inv.status !== InvoiceStatus.DRAFT) {
        throw new BadRequestException('not draft');
      }
    }),
  };
  const eventBus = { publish: jest.fn() };

  const service = new InvoiceLifecycleService(
    prismaService as never,
    authorizationService as never,
    access as never,
    composition as never,
    eventBus as never,
  );

  return { service, updateMany, findUniqueOrThrow, count, eventBus };
};

const draft = { id: 'inv-1', status: InvoiceStatus.DRAFT };

describe('InvoiceLifecycleService.issueSystem', () => {
  it('transitions a DRAFT invoice to ISSUED and publishes the event', async () => {
    const { service, updateMany, eventBus } = build({ invoice: draft });

    const result = await service.issueSystem('org-1', 'inv-1', 'actor-1');

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'inv-1', status: InvoiceStatus.DRAFT },
      data: { status: InvoiceStatus.ISSUED, issued_at: expect.any(Date) },
    });
    expect(result.status).toBe(InvoiceStatus.ISSUED);
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('rejects issuing an invoice with no items and never updates', async () => {
    const { service, updateMany } = build({ invoice: draft, itemCount: 0 });

    await expect(
      service.issueSystem('org-1', 'inv-1', 'actor-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('throws Conflict when a concurrent transition won the race (count !== 1)', async () => {
    const { service, eventBus } = build({ invoice: draft, updateCount: 0 });

    await expect(
      service.issueSystem('org-1', 'inv-1', 'actor-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(eventBus.publish).not.toHaveBeenCalled();
  });
});

describe('InvoiceLifecycleService.void', () => {
  const user = { profileId: 'prof-1' } as never;

  it('voids an ISSUED invoice with a status-guarded update', async () => {
    const { service, updateMany, eventBus } = build({
      invoice: { id: 'inv-1', status: InvoiceStatus.ISSUED },
    });

    await service.void('org-1', 'inv-1', user);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'inv-1',
        status: { in: [InvoiceStatus.DRAFT, InvoiceStatus.ISSUED] },
      },
      data: { status: InvoiceStatus.VOID },
    });
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('rejects voiding an invoice already in a terminal status', async () => {
    const { service, updateMany } = build({
      invoice: { id: 'inv-1', status: InvoiceStatus.PAID },
    });

    await expect(service.void('org-1', 'inv-1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('throws Conflict when the status changed before the guarded update (count !== 1)', async () => {
    const { service, eventBus } = build({
      invoice: { id: 'inv-1', status: InvoiceStatus.ISSUED },
      updateCount: 0,
    });

    await expect(service.void('org-1', 'inv-1', user)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(eventBus.publish).not.toHaveBeenCalled();
  });
});
