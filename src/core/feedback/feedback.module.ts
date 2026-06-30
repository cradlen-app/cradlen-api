import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { FeedbackController } from './feedback.controller.js';
import { FeedbackService } from './feedback.service.js';

// EmailService comes from the global EmailModule; SubscriptionsService (for the
// @SkipSubscriptionCheck guard reflection) is resolved globally by the guard.
@Module({
  imports: [DatabaseModule],
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
