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

/** Manual-proof provider: owner transfers to a mobile wallet, then uploads proof. */
@Injectable()
export class WalletPaymentProvider implements PaymentProvider {
  readonly key = SubscriptionPaymentProvider.WALLET;
  readonly settlementMode: PaymentSettlementMode = 'MANUAL_PROOF';
  readonly requiresProof = true;

  constructor(
    @Inject(paymentsConfig.KEY)
    private readonly config: ConfigType<typeof paymentsConfig>,
  ) {}

  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const payTo = this.config.wallet.number;
    return Promise.resolve({
      settlement_mode: this.settlementMode,
      requires_proof: this.requiresProof,
      instructions: {
        provider: this.key,
        pay_to: payTo,
        amount: input.amount,
        currency: input.currency,
        reference: input.paymentId,
        note: `Transfer ${input.amount} ${input.currency} to wallet ${payTo}, then upload the receipt as proof. Include reference ${input.paymentId}.`,
      },
    });
  }
}
