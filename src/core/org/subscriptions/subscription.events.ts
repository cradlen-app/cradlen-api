/**
 * Domain-event names for the subscription lifecycle. Publish via `EventBus`;
 * downstream consumers (notifications, analytics) subscribe with `@OnEvent`.
 */
export const SUBSCRIPTION_EVENTS = {
  payment: {
    submitted: 'subscription_payment.submitted',
    verified: 'subscription_payment.verified',
    rejected: 'subscription_payment.rejected',
  },
  activated: 'subscription.activated',
  expired: 'subscription.expired',
} as const;

export interface SubscriptionPaymentSubmittedEvent {
  payment_id: string;
  organization_id: string;
  amount: string;
  currency: string;
}

export interface SubscriptionPaymentVerifiedEvent {
  payment_id: string;
  organization_id: string;
  subscription_id: string;
  verified_by_id: string | null;
}

export interface SubscriptionPaymentRejectedEvent {
  payment_id: string;
  organization_id: string;
  reason: string;
}

export interface SubscriptionActivatedEvent {
  subscription_id: string;
  organization_id: string;
  subscription_plan_id: string;
  ends_at: string;
}

export interface SubscriptionExpiredEvent {
  subscription_id: string;
  organization_id: string;
  expired_at: string;
}
