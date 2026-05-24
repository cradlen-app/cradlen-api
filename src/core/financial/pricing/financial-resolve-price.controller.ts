import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiStandardResponse } from '@common/swagger/index.js';
import { PricingResolverService } from './pricing-resolver.service.js';

@ApiTags('Financial — Pricing')
@ApiBearerAuth()
@Controller('organizations/:orgId/financial')
export class ResolvePriceController {
  constructor(
    private readonly pricingResolverService: PricingResolverService,
  ) {}

  @Get('resolve-price')
  @ApiStandardResponse(Object)
  @ApiQuery({ name: 'serviceId', required: true })
  @ApiQuery({ name: 'branchId', required: true })
  @ApiQuery({ name: 'profileId', required: false })
  resolvePrice(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('serviceId') serviceId: string,
    @Query('branchId') branchId: string,
    @Query('profileId') profileId?: string,
  ) {
    return this.pricingResolverService.resolvePrice({
      organizationId: orgId,
      branchId,
      serviceId,
      profileId,
    });
  }
}
