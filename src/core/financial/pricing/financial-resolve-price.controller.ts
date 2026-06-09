import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiStandardResponse } from '@common/swagger/index.js';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { PricingResolverService } from './pricing-resolver.service.js';

@ApiTags('Financial — Pricing')
@ApiBearerAuth()
@Controller('organizations/:orgId/financial')
export class ResolvePriceController {
  constructor(
    private readonly pricingResolverService: PricingResolverService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  @Get('resolve-price')
  @ApiStandardResponse(Object)
  @ApiQuery({ name: 'serviceId', required: true })
  @ApiQuery({ name: 'branchId', required: true })
  @ApiQuery({ name: 'profileId', required: false })
  async resolvePrice(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('serviceId', ParseUUIDPipe) serviceId: string,
    @Query('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: AuthContext,
    @Query('profileId') profileId?: string,
  ) {
    await this.authorizationService.assertCanAccessOrganization(
      user.profileId,
      orgId,
    );
    return this.pricingResolverService.resolvePrice({
      organizationId: orgId,
      branchId,
      serviceId,
      profileId,
    });
  }
}
