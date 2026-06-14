import { ApiProperty } from '@nestjs/swagger';
import {
  BillingInterval,
  SubscriptionPaymentProvider,
  SubscriptionPaymentStatus,
} from '@prisma/client';

export class SubscriptionPaymentProofResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    nullable: true,
    description: 'Short-lived presigned GET URL for the proof file',
  })
  url!: string | null;

  @ApiProperty({ nullable: true })
  content_type!: string | null;

  @ApiProperty({ nullable: true })
  size_bytes!: number | null;

  @ApiProperty()
  created_at!: Date;
}

export class SubscriptionPaymentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organization_id!: string;

  @ApiProperty()
  subscription_plan_id!: string;

  @ApiProperty({ enum: SubscriptionPaymentProvider })
  provider!: SubscriptionPaymentProvider;

  @ApiProperty({ enum: BillingInterval })
  billing_interval!: BillingInterval;

  @ApiProperty({ description: 'Amount as a decimal string' })
  amount!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ enum: SubscriptionPaymentStatus })
  status!: SubscriptionPaymentStatus;

  @ApiProperty({ nullable: true })
  rejection_reason!: string | null;

  @ApiProperty({ nullable: true })
  verified_at!: Date | null;

  @ApiProperty()
  created_at!: Date;

  @ApiProperty({ type: [SubscriptionPaymentProofResponseDto], required: false })
  proofs?: SubscriptionPaymentProofResponseDto[];
}
