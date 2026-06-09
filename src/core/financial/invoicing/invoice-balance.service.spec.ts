import { InvoiceStatus, Prisma } from '@prisma/client';
import { InvoiceBalanceService } from './invoice-balance.service.js';

const d = (n: number) => new Prisma.Decimal(n);

describe('InvoiceBalanceService.recompute', () => {
  const buildTx = (total: number, payments: number[], refunds: number[]) => {
    const update = jest.fn().mockImplementation(({ data }) => data);
    return {
      tx: {
        invoice: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ total_amount: d(total) }),
          update,
        },
        payment: {
          findMany: jest
            .fn()
            .mockResolvedValue(payments.map((p) => ({ amount: d(p) }))),
        },
        refund: {
          findMany: jest
            .fn()
            .mockResolvedValue(refunds.map((r) => ({ amount: d(r) }))),
        },
      },
      update,
    };
  };

  it('persists balance_due and PARTIALLY_PAID for a partial payment', async () => {
    const { tx, update } = buildTx(200, [80], []);
    const service = new InvoiceBalanceService();
    await service.recompute(tx as never, 'inv-1');

    expect(update.mock.calls[0][0].data.status).toBe(
      InvoiceStatus.PARTIALLY_PAID,
    );
    expect(update.mock.calls[0][0].data.paid_amount.toFixed(2)).toBe('80.00');
    expect(update.mock.calls[0][0].data.balance_due.toFixed(2)).toBe('120.00');
  });

  it('zeroes balance_due when fully paid', async () => {
    const { tx, update } = buildTx(200, [120, 80], []);
    const service = new InvoiceBalanceService();
    await service.recompute(tx as never, 'inv-1');

    expect(update.mock.calls[0][0].data.status).toBe(InvoiceStatus.PAID);
    expect(update.mock.calls[0][0].data.balance_due.toFixed(2)).toBe('0.00');
  });

  it('restores balance_due net of a refund', async () => {
    const { tx, update } = buildTx(200, [200], [50]);
    const service = new InvoiceBalanceService();
    await service.recompute(tx as never, 'inv-1');

    // paid net = 200 - 50 = 150 → balance 50, PARTIALLY_PAID
    expect(update.mock.calls[0][0].data.paid_amount.toFixed(2)).toBe('150.00');
    expect(update.mock.calls[0][0].data.balance_due.toFixed(2)).toBe('50.00');
  });
});

describe('InvoiceBalanceService.deriveStatus', () => {
  it('returns PAID when paid >= total (incl. overpayment)', () => {
    expect(InvoiceBalanceService.deriveStatus(d(200), d(200))).toBe(
      InvoiceStatus.PAID,
    );
    expect(InvoiceBalanceService.deriveStatus(d(200), d(250))).toBe(
      InvoiceStatus.PAID,
    );
  });

  it('returns PARTIALLY_PAID for a partial payment', () => {
    expect(InvoiceBalanceService.deriveStatus(d(200), d(100))).toBe(
      InvoiceStatus.PARTIALLY_PAID,
    );
  });

  it('returns ISSUED when nothing is paid', () => {
    expect(InvoiceBalanceService.deriveStatus(d(200), d(0))).toBe(
      InvoiceStatus.ISSUED,
    );
  });

  it('returns PAID for a zero-total invoice', () => {
    expect(InvoiceBalanceService.deriveStatus(d(0), d(0))).toBe(
      InvoiceStatus.PAID,
    );
  });
});
