import { BadRequestException, Injectable } from '@nestjs/common';
import { SubscriptionPaymentProvider } from '@prisma/client';
import type { PaymentProvider } from './payment-provider.interface.js';
import { InstapayPaymentProvider } from './instapay.provider.js';
import { WalletPaymentProvider } from './wallet.provider.js';

/**
 * Resolves a `PaymentProvider` by its key. Providers are registered explicitly
 * here (and in the module). Adding a new provider = implement `PaymentProvider`,
 * inject it here, and add it to the map — no other code changes.
 */
@Injectable()
export class PaymentProviderFactory {
  private readonly providers: Map<SubscriptionPaymentProvider, PaymentProvider>;

  constructor(
    instapay: InstapayPaymentProvider,
    wallet: WalletPaymentProvider,
  ) {
    this.providers = new Map<SubscriptionPaymentProvider, PaymentProvider>([
      [instapay.key, instapay],
      [wallet.key, wallet],
    ]);
  }

  get(key: SubscriptionPaymentProvider): PaymentProvider {
    const provider = this.providers.get(key);
    if (!provider) {
      throw new BadRequestException(`Unsupported payment provider: ${key}`);
    }
    return provider;
  }
}
