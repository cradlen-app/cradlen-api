import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionPaymentProvider } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

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
}
