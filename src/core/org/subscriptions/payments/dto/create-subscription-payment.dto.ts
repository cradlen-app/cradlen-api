import { ApiProperty } from '@nestjs/swagger';
import { SubscriptionPaymentProvider } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

export class CreateSubscriptionPaymentDto {
  @ApiProperty({ description: 'Target plan code, e.g. "plus" / "pro"' })
  @IsString()
  @IsNotEmpty()
  plan!: string;

  @ApiProperty({ enum: SubscriptionPaymentProvider })
  @IsEnum(SubscriptionPaymentProvider)
  provider!: SubscriptionPaymentProvider;
}
