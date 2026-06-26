import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  OrganizationStatus,
  SubscriptionStatus,
  SubscriptionPaymentStatus,
  SubscriptionPaymentPurpose,
} from '@prisma/client';
import { PlanDistributionItemDto } from './admin-metrics.dto.js';

export class AdminOrganizationListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: OrganizationStatus }) status!: OrganizationStatus;
  @ApiProperty() branch_count!: number;
  @ApiProperty() staff_count!: number;
  @ApiProperty({
    description: 'Distinct patients with an ACTIVE org enrollment.',
  })
  enrolled_patients!: number;
  @ApiPropertyOptional({ nullable: true })
  subscription_status!: SubscriptionStatus | null;
  @ApiPropertyOptional({ nullable: true }) plan!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: "City of the org's main branch, if any.",
  })
  city!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: "Org's primary specialty.",
  })
  specialty!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Owner full name.' })
  primary_contact_name!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Owner email.' })
  primary_contact_email!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Monthly-equivalent recurring revenue; null unless ACTIVE & priced.',
  })
  mrr!: number | null;
  @ApiPropertyOptional({ nullable: true }) branch_limit!: number | null;
  @ApiPropertyOptional({ nullable: true }) staff_limit!: number | null;
  @ApiProperty() created_at!: Date;
}

export class AdminOrgOwnerDto {
  @ApiProperty() full_name!: string;
  @ApiPropertyOptional({ nullable: true }) email!: string | null;
  @ApiPropertyOptional({ nullable: true }) phone!: string | null;
  @ApiPropertyOptional({ nullable: true }) specialty!: string | null;
}

export class AdminOrgBillingDto {
  @ApiProperty() amount!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: ['MONTHLY', 'YEARLY'] }) interval!: 'MONTHLY' | 'YEARLY';
}

export class AdminOrgPlanLimitsDto {
  @ApiProperty() max_branches!: number;
  @ApiProperty() max_staff!: number;
}

export class AdminOrgBranchDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() city!: string;
  @ApiProperty() governorate!: string;
  @ApiProperty() staff_count!: number;
  @ApiProperty() is_main!: boolean;
}

export class AdminOrgAddressDto {
  @ApiProperty() address!: string;
  @ApiProperty() governorate!: string;
  @ApiPropertyOptional({ nullable: true }) country!: string | null;
}

export class AdminOrgActivityDto {
  @ApiProperty() type!: string;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty() created_at!: Date;
}

export class AdminOrgPortalDto {
  @ApiProperty({ description: 'Distinct patients with an ACTIVE enrollment.' })
  enrolled_patients!: number;
  @ApiProperty({ description: 'Enrolled patients who created a portal login.' })
  portal_accounts!: number;
  @ApiProperty({ description: 'Portal logins currently enabled (is_active).' })
  active_accounts!: number;
  @ApiPropertyOptional({
    nullable: true,
    description: 'portal_accounts / enrolled_patients as a percent; null if 0.',
  })
  activation_rate!: number | null;
  @ApiProperty({
    description: 'Distinct enrolled patients with a check-in this month.',
  })
  active_this_month!: number;
}

export class AdminSubscriptionAddOnDto {
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['BRANCH_BUNDLE', 'EXTRA_USER'] }) kind!: string;
  @ApiProperty() quantity!: number;
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Per-unit price at the subscription interval; null if unpriced.',
  })
  unit_amount!: number | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Line total (unit_amount × quantity); null if unpriced.',
  })
  amount!: number | null;
}

export class AdminOrganizationDetailDto extends AdminOrganizationListItemDto {
  @ApiPropertyOptional({ nullable: true }) subscription_ends_at!: Date | null;
  @ApiPropertyOptional({ nullable: true }) trial_ends_at!: Date | null;
  @ApiPropertyOptional({ nullable: true, type: AdminOrgOwnerDto })
  owner!: AdminOrgOwnerDto | null;
  @ApiPropertyOptional({ nullable: true, type: AdminOrgBillingDto })
  billing!: AdminOrgBillingDto | null;
  @ApiPropertyOptional({ nullable: true, type: AdminOrgPlanLimitsDto })
  plan_limits!: AdminOrgPlanLimitsDto | null;
  @ApiProperty({ type: [AdminOrgBranchDto] }) branches!: AdminOrgBranchDto[];
  @ApiPropertyOptional({ nullable: true, type: AdminOrgAddressDto })
  address!: AdminOrgAddressDto | null;
  @ApiProperty({ type: [AdminOrgActivityDto] })
  recent_activity!: AdminOrgActivityDto[];
  @ApiProperty({ type: AdminOrgPortalDto })
  portal!: AdminOrgPortalDto;
  @ApiProperty({ type: [AdminSubscriptionAddOnDto] })
  add_ons!: AdminSubscriptionAddOnDto[];
}

export class AdminSubscriptionListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() organization_id!: string;
  @ApiProperty() organization_name!: string;
  @ApiProperty() plan!: string;
  @ApiProperty({ enum: SubscriptionStatus }) status!: SubscriptionStatus;
  @ApiPropertyOptional({ nullable: true }) starts_at!: Date | null;
  @ApiPropertyOptional({ nullable: true }) ends_at!: Date | null;
  @ApiPropertyOptional({ nullable: true }) trial_ends_at!: Date | null;
  @ApiPropertyOptional({ enum: ['MONTHLY', 'YEARLY'], nullable: true })
  billing_interval!: 'MONTHLY' | 'YEARLY' | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Active plan price for the chosen interval.',
  })
  amount!: number | null;
  @ApiPropertyOptional({ nullable: true }) currency!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Monthly-equivalent recurring revenue; null unless ACTIVE.',
  })
  mrr!: number | null;
  @ApiProperty({ description: 'Count of ACTIVE add-ons on this subscription.' })
  add_on_count!: number;
  @ApiProperty({ type: [AdminSubscriptionAddOnDto] })
  add_ons!: AdminSubscriptionAddOnDto[];
}

export class AdminPlanOptionDto {
  @ApiProperty({ description: 'Unique plan code (e.g. individual).' })
  plan!: string;
  @ApiProperty() max_branches!: number;
  @ApiProperty() max_staff!: number;
  @ApiPropertyOptional({ nullable: true, description: 'Active plan price.' })
  amount!: number | null;
  @ApiPropertyOptional({ nullable: true }) currency!: string | null;
  @ApiPropertyOptional({ enum: ['MONTHLY', 'YEARLY'], nullable: true })
  billing_interval!: 'MONTHLY' | 'YEARLY' | null;
}

export class AdminSubscriptionStatsDto {
  @ApiProperty() total!: number;
  @ApiProperty() active!: number;
  @ApiProperty() trial!: number;
  @ApiProperty() expired!: number;
  @ApiProperty() cancelled!: number;
  @ApiProperty({
    description: 'Sum of monthly-equivalent MRR over ACTIVE subs.',
  })
  mrr!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ type: [PlanDistributionItemDto] })
  plan_distribution!: PlanDistributionItemDto[];
}

export class AdminPaymentProofDto {
  @ApiProperty() id!: string;
  @ApiProperty({
    description: 'Short-lived presigned GET URL for the proof file.',
  })
  url!: string;
  @ApiPropertyOptional({ nullable: true }) content_type!: string | null;
  @ApiPropertyOptional({ nullable: true }) size_bytes!: number | null;
  @ApiProperty() created_at!: Date;
}

export class AdminPaymentListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() organization_id!: string;
  @ApiProperty() organization_name!: string;
  @ApiProperty({ enum: SubscriptionPaymentPurpose })
  purpose!: SubscriptionPaymentPurpose;
  @ApiProperty() plan!: string;
  @ApiProperty({ enum: SubscriptionPaymentStatus })
  status!: SubscriptionPaymentStatus;
  @ApiProperty() provider!: string;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Provider-specific payment reference (e.g. InstaPay tx id).',
  })
  reference!: string | null;
  @ApiProperty({ enum: ['MONTHLY', 'YEARLY'] })
  billing_interval!: 'MONTHLY' | 'YEARLY';
  @ApiProperty({ description: 'Decimal serialized as string.' })
  amount!: string;
  @ApiProperty() currency!: string;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Full name of the staff member who submitted the payment.',
  })
  submitted_by_name!: string | null;
  @ApiPropertyOptional({ nullable: true })
  submitted_by_email!: string | null;
  @ApiPropertyOptional({ nullable: true }) verified_by_id!: string | null;
  @ApiPropertyOptional({ nullable: true }) verified_at!: Date | null;
  @ApiPropertyOptional({ nullable: true }) rejection_reason!: string | null;
  @ApiProperty() created_at!: Date;
}

export class AdminPaymentItemDto {
  @ApiProperty({ enum: ['PLAN', 'ADD_ON'] }) kind!: 'PLAN' | 'ADD_ON';
  @ApiProperty({
    description: 'Plan name for the PLAN line, add-on name for ADD_ON lines.',
  })
  label!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty({ description: 'Per-unit price; Decimal serialized as string.' })
  unit_amount!: string;
  @ApiProperty({ description: 'Line total (qty x unit); Decimal as string.' })
  amount!: string;
}

export class AdminPaymentDetailDto extends AdminPaymentListItemDto {
  @ApiPropertyOptional({ nullable: true })
  submitted_by_phone!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Name of the platform admin who verified/rejected the payment.',
  })
  verified_by_name!: string | null;
  @ApiProperty({ type: [AdminPaymentProofDto] })
  proofs!: AdminPaymentProofDto[];
  @ApiProperty({
    type: [AdminPaymentItemDto],
    description: 'Line-item breakdown; empty for non-COMBINED payments.',
  })
  items!: AdminPaymentItemDto[];
}
