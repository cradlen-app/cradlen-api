import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { ApiStandardResponse } from '@common/swagger/index.js';
import { SkipSubscriptionCheck } from '@core/org/subscriptions/skip-subscription-check.decorator.js';
import { CreateFeedbackDto, FeedbackResponseDto } from './dto/feedback.dto.js';
import { FeedbackService } from './feedback.service.js';

@ApiTags('Feedback')
@ApiBearerAuth()
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  // A lapsed subscription must not block "Help us improve" feedback — churning
  // users are exactly who we want to hear from.
  @SkipSubscriptionCheck()
  @ApiOperation({
    summary: 'Submit an in-app suggestion to improve Cradlen',
    description:
      'Persists a staff/doctor suggestion (category + message) and best-effort emails the Cradlen team. Submitter identity and context are captured from the session.',
  })
  @ApiStandardResponse(FeedbackResponseDto)
  submit(@CurrentUser() user: AuthContext, @Body() dto: CreateFeedbackDto) {
    return this.feedbackService.submit(user, dto);
  }
}
