import { ApiProperty } from '@nestjs/swagger';
import { BillingInterval } from '@prisma/client';

export class PlanPriceResponseDto {
  @ApiProperty({ enum: BillingInterval })
  billing_interval!: BillingInterval;

  @ApiProperty({ description: 'Price as a decimal string' })
  price!: string;

  @ApiProperty()
  currency!: string;
}

export class SubscriptionPlanResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Plan code, e.g. "plus"' })
  plan!: string;

  @ApiProperty()
  max_organizations!: number;

  @ApiProperty()
  max_branches!: number;

  @ApiProperty()
  max_staff!: number;

  @ApiProperty({ type: [PlanPriceResponseDto] })
  prices!: PlanPriceResponseDto[];
}
