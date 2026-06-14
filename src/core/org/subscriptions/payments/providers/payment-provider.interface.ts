import type { SubscriptionPaymentProvider } from '@prisma/client';
import type {
  InitiatePaymentInput,
  InitiatePaymentResult,
  PaymentSettlementMode,
  ProviderVerificationResult,
} from './provider.types.js';

/**
 * The settlement contract every payment provider implements. Manual-proof
 * providers (InstaPay, wallet) implement `initiate` only; a future online
 * gateway additionally implements `handleCallback`. New providers are added by
 * implementing this interface and registering them in `PaymentProviderFactory`
 * — no change to the payment service or schema is required.
 */
export interface PaymentProvider {
  readonly key: SubscriptionPaymentProvider;
  readonly settlementMode: PaymentSettlementMode;
  readonly requiresProof: boolean;

  /** Begins a payment: returns transfer instructions (manual) or a checkout URL (gateway). */
  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;

  /** Verifies a gateway callback/webhook. Omitted by manual-proof providers. */
  handleCallback?(payload: unknown): Promise<ProviderVerificationResult>;
}
