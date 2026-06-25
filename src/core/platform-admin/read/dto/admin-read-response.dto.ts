import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  OrganizationStatus,
  SubscriptionStatus,
  SubscriptionPaymentStatus,
  SubscriptionPaymentPurpose,
} from '@prisma/client';

export class AdminOrganizationListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: OrganizationStatus }) status!: OrganizationStatus;
  @ApiProperty() branch_count!: number;
  @ApiProperty() staff_count!: number;
  @ApiPropertyOptional({ nullable: true })
  subscription_status!: SubscriptionStatus | null;
  @ApiPropertyOptional({ nullable: true }) plan!: string | null;
  @ApiProperty() created_at!: Date;
}

export class AdminOrganizationDetailDto extends AdminOrganizationListItemDto {
  @ApiPropertyOptional({ nullable: true }) subscription_ends_at!: Date | null;
  @ApiPropertyOptional({ nullable: true }) trial_ends_at!: Date | null;
}

export class AdminUserProfileDto {
  @ApiProperty() profile_id!: string;
  @ApiProperty() organization_id!: string;
  @ApiProperty() organization_name!: string;
  @ApiPropertyOptional({ nullable: true }) role!: string | null;
  @ApiProperty() is_active!: boolean;
}

export class AdminUserListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() first_name!: string;
  @ApiProperty() last_name!: string;
  @ApiPropertyOptional({ nullable: true }) email!: string | null;
  @ApiPropertyOptional({ nullable: true }) phone_number!: string | null;
  @ApiProperty() is_active!: boolean;
  @ApiProperty() profile_count!: number;
  @ApiProperty({ type: [AdminUserProfileDto] })
  profiles!: AdminUserProfileDto[];
  @ApiProperty() created_at!: Date;
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
  @ApiProperty({ description: 'Decimal serialized as string.' })
  amount!: string;
  @ApiProperty() currency!: string;
  @ApiPropertyOptional({ nullable: true }) verified_by_id!: string | null;
  @ApiPropertyOptional({ nullable: true }) verified_at!: Date | null;
  @ApiPropertyOptional({ nullable: true }) rejection_reason!: string | null;
  @ApiProperty() created_at!: Date;
}

export class AdminPaymentDetailDto extends AdminPaymentListItemDto {
  @ApiProperty({ type: [AdminPaymentProofDto] })
  proofs!: AdminPaymentProofDto[];
}
