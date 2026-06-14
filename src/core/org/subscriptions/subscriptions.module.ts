import { Module } from '@nestjs/common';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { SubscriptionExpiryJob } from './subscription-expiry.job.js';
import { SubscriptionsController } from './subscriptions.controller.js';
import { SubscriptionPlansController } from './plans/subscription-plans.controller.js';
import { SubscriptionPlansService } from './plans/subscription-plans.service.js';
import { SubscriptionPaymentsController } from './payments/subscription-payments.controller.js';
import { SubscriptionPaymentsService } from './payments/subscription-payments.service.js';
import { SubscriptionPaymentProofsController } from './payments/proofs/subscription-payment-proofs.controller.js';
import { SubscriptionPaymentProofsService } from './payments/proofs/subscription-payment-proofs.service.js';
import { PaymentProviderFactory } from './payments/providers/payment-provider.factory.js';
import { InstapayPaymentProvider } from './payments/providers/instapay.provider.js';
import { WalletPaymentProvider } from './payments/providers/wallet.provider.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [
    SubscriptionsController,
    SubscriptionPlansController,
    SubscriptionPaymentsController,
    SubscriptionPaymentProofsController,
  ],
  providers: [
    SubscriptionsService,
    SubscriptionExpiryJob,
    SubscriptionPlansService,
    SubscriptionPaymentsService,
    SubscriptionPaymentProofsService,
    PaymentProviderFactory,
    InstapayPaymentProvider,
    WalletPaymentProvider,
  ],
  exports: [SubscriptionsService, SubscriptionPaymentsService],
})
export class SubscriptionsModule {}
