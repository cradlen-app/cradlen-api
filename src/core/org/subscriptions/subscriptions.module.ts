import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service.js';
import { SubscriptionTrialExpiryJob } from './subscription-trial-expiry.job.js';

@Module({
  providers: [SubscriptionsService, SubscriptionTrialExpiryJob],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
