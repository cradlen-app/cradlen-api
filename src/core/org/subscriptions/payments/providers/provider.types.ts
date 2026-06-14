import type { SubscriptionPaymentProvider } from '@prisma/client';

/**
 * How a provider settles a payment:
 * - MANUAL_PROOF: owner pays out-of-band and uploads proof; verified offline.
 * - GATEWAY: provider charges online and confirms via redirect/webhook (future).
 */
export type PaymentSettlementMode = 'MANUAL_PROOF' | 'GATEWAY';

/** Human-facing instructions for a manual transfer. */
export interface PaymentInstructions {
  provider: SubscriptionPaymentProvider;
  /** InstaPay address / wallet number to transfer to. */
  pay_to: string;
  amount: string;
  currency: string;
  /** Reference (the payment id) the owner should include in the transfer note. */
  reference: string;
  note: string;
}

export interface InitiatePaymentInput {
  paymentId: string;
  amount: string;
  currency: string;
}

export interface InitiatePaymentResult {
  settlement_mode: PaymentSettlementMode;
  requires_proof: boolean;
  /** Present for MANUAL_PROOF providers. */
  instructions?: PaymentInstructions;
  /** Present for GATEWAY providers (future). */
  redirect_url?: string;
  provider_ref?: string;
}

/** Result of validating a gateway callback/webhook (future). */
export interface ProviderVerificationResult {
  verified: boolean;
  provider_ref?: string;
}
