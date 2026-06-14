import { BadRequestException } from '@nestjs/common';
import { SubscriptionPaymentProvider } from '@prisma/client';
import { PaymentProviderFactory } from './payment-provider.factory.js';
import { InstapayPaymentProvider } from './instapay.provider.js';
import { WalletPaymentProvider } from './wallet.provider.js';

const config = {
  instapay: { address: 'pay@instapay' },
  wallet: { number: '0100' },
};

describe('PaymentProviderFactory', () => {
  const factory = new PaymentProviderFactory(
    new InstapayPaymentProvider(config),
    new WalletPaymentProvider(config),
  );

  it('resolves the InstaPay provider', () => {
    const provider = factory.get(SubscriptionPaymentProvider.INSTAPAY);
    expect(provider.key).toBe(SubscriptionPaymentProvider.INSTAPAY);
    expect(provider.requiresProof).toBe(true);
    expect(provider.settlementMode).toBe('MANUAL_PROOF');
  });

  it('resolves the wallet provider', () => {
    expect(factory.get(SubscriptionPaymentProvider.WALLET).key).toBe(
      SubscriptionPaymentProvider.WALLET,
    );
  });

  it('throws for an unsupported provider', () => {
    expect(() => factory.get('PAYMOB' as SubscriptionPaymentProvider)).toThrow(
      BadRequestException,
    );
  });

  it('initiate returns transfer instructions carrying the pay-to and reference', async () => {
    const result = await factory
      .get(SubscriptionPaymentProvider.INSTAPAY)
      .initiate({ paymentId: 'pay-1', amount: '12000', currency: 'EGP' });
    expect(result.requires_proof).toBe(true);
    expect(result.instructions?.pay_to).toBe('pay@instapay');
    expect(result.instructions?.reference).toBe('pay-1');
    expect(result.instructions?.amount).toBe('12000');
  });
});
