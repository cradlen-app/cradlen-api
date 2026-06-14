import { SetMetadata } from '@nestjs/common';

export const SKIP_SUBSCRIPTION_CHECK = 'skipSubscriptionCheck';

/**
 * Opts a controller/handler out of the `SubscriptionGuard` write-block. Applied
 * to the subscription, payment, and proof surfaces so an org with an expired
 * subscription can still view its plan and pay to renew.
 */
export const SkipSubscriptionCheck = () =>
  SetMetadata(SKIP_SUBSCRIPTION_CHECK, true);
