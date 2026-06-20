import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChargeSource } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { MAX_MONETARY_AMOUNT } from '../../shared/money/money.js';

export class CaptureChargeDto {
  @ApiProperty({ description: 'Branch where the service was rendered.' })
  @IsUUID('4')
  branch_id!: string;

  @ApiProperty()
  @IsUUID('4')
  patient_id!: string;

  @ApiProperty({ description: 'Rendering provider (Profile id).' })
  @IsUUID('4')
  profile_id!: string;

  @ApiPropertyOptional()
  @IsUUID('4')
  @IsOptional()
  visit_id?: string;

  @ApiPropertyOptional({
    description:
      'Catalog service id. When present the price is resolved from the pricing tiers unless unit_price is given.',
  })
  @IsUUID('4')
  @IsOptional()
  service_id?: string;

  @ApiPropertyOptional({
    description: 'Defaults to the service name when a service_id is supplied.',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number = 1;

  @ApiPropertyOptional({
    description:
      'Explicit unit price. Overrides price resolution and marks the charge CUSTOM.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_MONETARY_AMOUNT)
  @IsOptional()
  unit_price?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({
    enum: ChargeSource,
    description:
      'Who originated the charge. Defaults to DOCTOR when the capturing profile is the rendering provider, otherwise RECEPTION.',
  })
  @IsEnum(ChargeSource)
  @IsOptional()
  source?: ChargeSource;
}
