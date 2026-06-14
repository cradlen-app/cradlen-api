import { ApiProperty } from '@nestjs/swagger';
import { SubscriptionStatus } from '@prisma/client';

class CurrentSubscriptionPlanDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  plan!: string;

  @ApiProperty()
  max_organizations!: number;

  @ApiProperty()
  max_branches!: number;

  @ApiProperty()
  max_staff!: number;
}

export class CurrentSubscriptionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: SubscriptionStatus })
  status!: SubscriptionStatus;

  @ApiProperty()
  starts_at!: Date;

  @ApiProperty({ nullable: true })
  ends_at!: Date | null;

  @ApiProperty({ nullable: true })
  trial_ends_at!: Date | null;

  @ApiProperty({ type: CurrentSubscriptionPlanDto })
  plan!: CurrentSubscriptionPlanDto;
}
