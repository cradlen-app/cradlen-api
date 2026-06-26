import { ApiProperty } from '@nestjs/swagger';

export class PlanDistributionItemDto {
  @ApiProperty() plan!: string;
  @ApiProperty() count!: number;
}

export class RevenuePointDto {
  @ApiProperty({ description: "Month bucket as 'YYYY-MM'." })
  month!: string;
  @ApiProperty({ description: 'Verified revenue in that month.' })
  amount!: number;
}

/**
 * One-shot snapshot powering the admin Overview dashboard: headline counts,
 * an 8-month verified-revenue trend, and the active-plan breakdown.
 */
export class AdminMetricsOverviewDto {
  @ApiProperty() organizations_total!: number;
  @ApiProperty({ description: 'Organizations created since the 1st of this month.' })
  organizations_added_this_month!: number;
  @ApiProperty() active_subscriptions!: number;
  @ApiProperty({ description: 'Payments in AWAITING_VERIFICATION.' })
  awaiting_payments_total!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ description: 'Verified revenue in the current month.' })
  monthly_recurring_revenue!: number;
  @ApiProperty({
    nullable: true,
    description: 'Month-over-month change vs the previous month, as a percent.',
  })
  mrr_change_pct!: number | null;
  @ApiProperty({ type: [RevenuePointDto] })
  revenue_history!: RevenuePointDto[];
  @ApiProperty({ type: [PlanDistributionItemDto] })
  plan_distribution!: PlanDistributionItemDto[];
}
