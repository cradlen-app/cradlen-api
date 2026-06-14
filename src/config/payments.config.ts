import { registerAs } from '@nestjs/config';

/**
 * Settlement details for manual-proof subscription payment providers. The owner
 * transfers funds out-of-band to these destinations, then uploads a proof. Left
 * optional (empty default) so boot never fails in environments that have not yet
 * configured a provider; the value surfaces in the payment instructions only.
 */
export interface PaymentsConfig {
  instapay: { address: string };
  wallet: { number: string };
}

export default registerAs(
  'payments',
  (): PaymentsConfig => ({
    instapay: { address: process.env.INSTAPAY_ADDRESS ?? '' },
    wallet: { number: process.env.WALLET_NUMBER ?? '' },
  }),
);
