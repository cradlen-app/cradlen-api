import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { AdminJwtAuthGuard } from '@common/guards/admin-jwt-auth.guard.js';
import {
  ApiPaginatedResponse,
  ApiStandardArrayResponse,
  ApiStandardResponse,
} from '@common/swagger/index.js';
import { AdminOrganizationsService } from './admin-organizations.service.js';
import { AdminSubscriptionsService } from './admin-subscriptions.service.js';
import { AdminPaymentsService } from './admin-payments.service.js';
import { AdminMetricsService } from './admin-metrics.service.js';
import { AdminDailyMetricsService } from './admin-daily-metrics.service.js';
import {
  AdminDailyTrendsQueryDto,
  AdminOrganizationsQueryDto,
  AdminPaymentsQueryDto,
  AdminSubscriptionsQueryDto,
} from './dto/admin-list-query.dto.js';
import { AdminDailyMetricPointDto } from './dto/admin-daily-metrics.dto.js';
import {
  AdminOrganizationDetailDto,
  AdminOrganizationListItemDto,
  AdminPaymentDetailDto,
  AdminPaymentListItemDto,
  AdminPlanOptionDto,
  AdminSubscriptionListItemDto,
  AdminSubscriptionStatsDto,
} from './dto/admin-read-response.dto.js';
import { AdminMetricsOverviewDto } from './dto/admin-metrics.dto.js';

/**
 * Cross-tenant read surfaces for the platform-admin dashboard. Every route is
 * `@Public()` to bypass the org-scoped staff JwtAuthGuard, then re-protected by
 * AdminJwtAuthGuard — admins have no organization, so authority is simply
 * "is an active platform admin".
 */
@ApiTags('Platform Admin')
@ApiBearerAuth()
@Public()
@UseGuards(AdminJwtAuthGuard)
@Controller({ path: 'admin', version: '1' })
export class AdminReadController {
  constructor(
    private readonly organizations: AdminOrganizationsService,
    private readonly subscriptions: AdminSubscriptionsService,
    private readonly payments: AdminPaymentsService,
    private readonly metrics: AdminMetricsService,
    private readonly dailyMetrics: AdminDailyMetricsService,
  ) {}

  @Get('metrics/overview')
  @ApiOperation({
    summary: 'Aggregated metrics for the admin Overview dashboard',
  })
  @ApiStandardResponse(AdminMetricsOverviewDto)
  getMetricsOverview(): Promise<AdminMetricsOverviewDto> {
    return this.metrics.getOverview();
  }

  @Get('metrics/daily-trends')
  @ApiOperation({
    summary: 'Per-day active-staff and active-portal trend vs totals',
  })
  @ApiStandardArrayResponse(AdminDailyMetricPointDto)
  getDailyTrends(
    @Query() query: AdminDailyTrendsQueryDto,
  ): Promise<AdminDailyMetricPointDto[]> {
    return this.dailyMetrics.getDailyTrends(query.days);
  }

  @Get('organizations')
  @ApiOperation({ summary: 'List all organizations across tenants' })
  @ApiPaginatedResponse(AdminOrganizationListItemDto)
  listOrganizations(@Query() query: AdminOrganizationsQueryDto) {
    return this.organizations.list(query);
  }

  @Get('organizations/:id')
  @ApiOperation({ summary: 'Get one organization with subscription detail' })
  @ApiStandardResponse(AdminOrganizationDetailDto)
  getOrganization(
    @Param('id') id: string,
  ): Promise<AdminOrganizationDetailDto> {
    return this.organizations.get(id);
  }

  @Get('subscriptions/stats')
  @ApiOperation({ summary: 'Subscription totals, MRR, and plan mix' })
  @ApiStandardResponse(AdminSubscriptionStatsDto)
  subscriptionStats(): Promise<AdminSubscriptionStatsDto> {
    return this.subscriptions.stats();
  }

  @Get('subscriptions/plans')
  @ApiOperation({ summary: 'Available plan tiers for the change-plan picker' })
  @ApiStandardArrayResponse(AdminPlanOptionDto)
  subscriptionPlans(): Promise<AdminPlanOptionDto[]> {
    return this.subscriptions.plans();
  }

  @Get('subscriptions')
  @ApiOperation({ summary: 'List all subscriptions across tenants' })
  @ApiPaginatedResponse(AdminSubscriptionListItemDto)
  listSubscriptions(@Query() query: AdminSubscriptionsQueryDto) {
    return this.subscriptions.list(query);
  }

  @Get('subscription-payments')
  @ApiOperation({ summary: 'List all subscription payments across tenants' })
  @ApiPaginatedResponse(AdminPaymentListItemDto)
  listPayments(@Query() query: AdminPaymentsQueryDto) {
    return this.payments.list(query);
  }

  @Get('subscription-payments/:id')
  @ApiOperation({
    summary: 'Get one payment with presigned proof URLs',
  })
  @ApiStandardResponse(AdminPaymentDetailDto)
  getPayment(@Param('id') id: string): Promise<AdminPaymentDetailDto> {
    return this.payments.get(id);
  }
}
