import { Test } from '@nestjs/testing';
import { ChargeSource, PricingSource, Prisma } from '@prisma/client';
import { InvoiceAccrualListener } from './invoice-accrual.listener.js';
import { InvoicingService } from './invoicing.service.js';
import type { ChargeCapturedEvent } from '../shared/events/financial-events.js';

const event: ChargeCapturedEvent = {
  charge_id: 'chg-1',
  organization_id: 'org-1',
  branch_id: 'br-1',
  patient_id: 'pat-1',
  visit_id: 'visit-1',
  service_id: 'svc-1',
  amount: new Prisma.Decimal('150.00'),
  pricing_source: PricingSource.ORG_PRICE_LIST,
  source: ChargeSource.DOCTOR,
  captured_by_id: 'p1',
};

describe('InvoiceAccrualListener', () => {
  let listener: InvoiceAccrualListener;
  const invoicing = { ensureInvoiceForCharge: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        InvoiceAccrualListener,
        { provide: InvoicingService, useValue: invoicing },
      ],
    }).compile();
    listener = module.get(InvoiceAccrualListener);
    jest.clearAllMocks();
  });

  it('bills the captured charge onto its case invoice', async () => {
    await listener.handleChargeCaptured(event);

    expect(invoicing.ensureInvoiceForCharge).toHaveBeenCalledWith({
      organization_id: 'org-1',
      branch_id: 'br-1',
      patient_id: 'pat-1',
      visit_id: 'visit-1',
      charge_id: 'chg-1',
      captured_by_id: 'p1',
    });
  });

  it('swallows accrual failures (best-effort — the charge is already persisted)', async () => {
    invoicing.ensureInvoiceForCharge.mockRejectedValue(new Error('pricing gap'));

    await expect(listener.handleChargeCaptured(event)).resolves.toBeUndefined();
  });
});
