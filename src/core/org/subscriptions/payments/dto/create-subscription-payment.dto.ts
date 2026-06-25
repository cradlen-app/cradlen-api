import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionPaymentProvider } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CombinedAddOnLineDto {
  @ApiProperty({ description: 'Add-on code to bundle with the plan purchase.' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({
    description: 'How many units of the add-on to buy.',
    default: 1,
  })
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateSubscriptionPaymentDto {
  @ApiProperty({
    description:
      'Target base-plan code, e.g. "individual" / "center" / "network"',
  })
  @IsString()
  @IsNotEmpty()
  plan!: string;

  @ApiProperty({ enum: SubscriptionPaymentProvider })
  @IsEnum(SubscriptionPaymentProvider)
  provider!: SubscriptionPaymentProvider;

  @ApiPropertyOptional({
    description:
      'Add-on code to purchase on top of the current plan, e.g. "center_extra_branch". When set, the payment is an add-on purchase (prorated to the remaining term) rather than a plan change.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  add_on_code?: string;

  @ApiPropertyOptional({
    description: 'How many units of the add-on to buy (default 1).',
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({
    description:
      'Add-ons to buy together with the plan in a single payment (combined checkout). When set alongside `plan`, the payment activates the plan AND grants these add-ons atomically — e.g. switching to Individual while buying extra seats to keep all staff.',
    type: [CombinedAddOnLineDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CombinedAddOnLineDto)
  add_ons?: CombinedAddOnLineDto[];
}
