import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { ApiStandardResponse } from '@common/swagger/index.js';
import { SubscriptionPlansService } from './subscription-plans.service.js';
import { SubscriptionPlanResponseDto } from './dto/subscription-plan-response.dto.js';

@ApiTags('Subscription Plans')
@Controller('subscription-plans')
export class SubscriptionPlansController {
  constructor(
    private readonly subscriptionPlansService: SubscriptionPlansService,
  ) {}

  @Get()
  @Public()
  @ApiStandardResponse(SubscriptionPlanResponseDto)
  list() {
    return this.subscriptionPlansService.list();
  }
}
