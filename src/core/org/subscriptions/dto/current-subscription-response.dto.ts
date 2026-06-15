import { ApiProperty } from '@nestjs/swagger';
import { AddOnKind, SubscriptionStatus } from '@prisma/client';

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

class EffectiveLimitsDto {
  @ApiProperty({ description: 'Base branches + active branch add-ons' })
  max_branches!: number;

  @ApiProperty({ description: 'Base users + active user/branch add-ons' })
  max_staff!: number;
}

class OwnedAddOnDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: AddOnKind })
  kind!: AddOnKind;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({ nullable: true })
  ends_at!: Date | null;
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

  @ApiProperty({
    type: EffectiveLimitsDto,
    description:
      'Base plan limits + active add-ons (what the org may actually use)',
  })
  effective_limits!: EffectiveLimitsDto;

  @ApiProperty({ type: [OwnedAddOnDto] })
  add_ons!: OwnedAddOnDto[];
}
