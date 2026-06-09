import { Test } from '@nestjs/testing';
import { PaymentMethod, Prisma } from '@prisma/client';
import { ReceiptsListener } from './receipts.listener.js';
import { ReceiptsService } from './receipts.service.js';
import type { PaymentRecordedEvent } from '../shared/events/financial-events.js';

const mockService = {
  issueForPayment: jest.fn(),
  voidForPayment: jest.fn(),
};

const recordedEvent: PaymentRecordedEvent = {
  payment_id: 'pay-1',
  invoice_id: 'inv-1',
  organization_id: 'org-1',
  branch_id: 'br-1',
  amount: new Prisma.Decimal('80.00'),
  payment_method: PaymentMethod.CASH,
  cash_session_id: null,
  recorded_by_id: 'p1',
};

describe('ReceiptsListener', () => {
  let listener: ReceiptsListener;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ReceiptsListener,
        { provide: ReceiptsService, useValue: mockService },
      ],
    }).compile();

    listener = module.get(ReceiptsListener);
    jest.clearAllMocks();
  });

  it('issues a receipt on payment.recorded', async () => {
    mockService.issueForPayment.mockResolvedValue({});
    await listener.handlePaymentRecorded(recordedEvent);
    expect(mockService.issueForPayment).toHaveBeenCalledWith(recordedEvent);
  });

  it('voids a receipt on payment.voided', async () => {
    mockService.voidForPayment.mockResolvedValue(undefined);
    await listener.handlePaymentVoided({
      payment_id: 'pay-1',
      invoice_id: 'inv-1',
      organization_id: 'org-1',
    });
    expect(mockService.voidForPayment).toHaveBeenCalled();
  });

  it('swallows and logs errors so the payment flow is unaffected', async () => {
    mockService.issueForPayment.mockRejectedValue(new Error('boom'));
    await expect(
      listener.handlePaymentRecorded(recordedEvent),
    ).resolves.toBeUndefined();
  });
});
