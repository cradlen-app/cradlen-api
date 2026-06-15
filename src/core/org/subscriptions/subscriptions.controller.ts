import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { ApiStandardResponse } from '@common/swagger/index.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { SkipSubscriptionCheck } from './skip-subscription-check.decorator.js';
import { CurrentSubscriptionResponseDto } from './dto/current-subscription-response.dto.js';
import { AvailableAddOnResponseDto } from './dto/available-add-on-response.dto.js';

@ApiTags('Subscriptions')
@ApiBearerAuth()
@SkipSubscriptionCheck()
@Controller('organizations/:orgId/subscription')
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  @Get()
  @ApiStandardResponse(CurrentSubscriptionResponseDto)
  async getCurrent(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: AuthContext,
  ): Promise<CurrentSubscriptionResponseDto> {
    await this.authorizationService.assertCanAccessOrganization(
      user.profileId,
      orgId,
    );
    const sub = await this.subscriptionsService.getCurrent(orgId);

    let maxBranches = sub.subscription_plan.max_branches;
    let maxStaff = sub.subscription_plan.max_staff;
    for (const owned of sub.add_ons) {
      maxBranches += owned.add_on.delta_branches * owned.quantity;
      maxStaff += owned.add_on.delta_users * owned.quantity;
    }

    return {
      id: sub.id,
      status: sub.status,
      starts_at: sub.starts_at,
      ends_at: sub.ends_at,
      trial_ends_at: sub.trial_ends_at,
      plan: {
        id: sub.subscription_plan.id,
        plan: sub.subscription_plan.plan,
        max_organizations: sub.subscription_plan.max_organizations,
        max_branches: sub.subscription_plan.max_branches,
        max_staff: sub.subscription_plan.max_staff,
      },
      effective_limits: { max_branches: maxBranches, max_staff: maxStaff },
      add_ons: sub.add_ons.map((owned) => ({
        id: owned.id,
        code: owned.add_on.code,
        name: owned.add_on.name,
        kind: owned.add_on.kind,
        quantity: owned.quantity,
        ends_at: owned.ends_at,
      })),
    };
  }

  @Get('add-ons')
  @ApiStandardResponse(AvailableAddOnResponseDto)
  async listAvailableAddOns(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: AuthContext,
  ): Promise<AvailableAddOnResponseDto[]> {
    await this.authorizationService.assertCanAccessOrganization(
      user.profileId,
      orgId,
    );
    return this.subscriptionsService.listAvailableAddOns(orgId);
  }
}
