import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { SubscriptionPaymentProvider } from '@prisma/client';
import paymentsConfig from '@config/payments.config.js';
import type { PaymentProvider } from './payment-provider.interface.js';
import type {
  InitiatePaymentInput,
  InitiatePaymentResult,
  PaymentSettlementMode,
} from './provider.types.js';

/** Manual-proof provider: owner transfers via InstaPay, then uploads a receipt. */
@Injectable()
export class InstapayPaymentProvider implements PaymentProvider {
  readonly key = SubscriptionPaymentProvider.INSTAPAY;
  readonly settlementMode: PaymentSettlementMode = 'MANUAL_PROOF';
  readonly requiresProof = true;

  constructor(
    @Inject(paymentsConfig.KEY)
    private readonly config: ConfigType<typeof paymentsConfig>,
  ) {}

  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const payTo = this.config.instapay.address;
    return Promise.resolve({
      settlement_mode: this.settlementMode,
      requires_proof: this.requiresProof,
      instructions: {
        provider: this.key,
        pay_to: payTo,
        amount: input.amount,
        currency: input.currency,
        reference: input.paymentId,
        note: `Transfer ${input.amount} ${input.currency} via InstaPay to ${payTo}, then upload the receipt as proof. Include reference ${input.paymentId}.`,
      },
    });
  }
}
