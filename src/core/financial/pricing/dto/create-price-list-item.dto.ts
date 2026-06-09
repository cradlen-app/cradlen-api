import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DiscountType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { PriceTierDto } from './price-tier.dto.js';

export class CreatePriceListItemDto {
  @ApiProperty()
  @IsUUID()
  service_id!: string;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unit_price!: number;

  @ApiPropertyOptional({ enum: DiscountType })
  @IsEnum(DiscountType)
  @IsOptional()
  discount_type?: DiscountType;

  @ApiPropertyOptional({
    description: 'Percent (0–100) when PERCENTAGE, else a fixed amount.',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  discount_value?: number;

  @ApiPropertyOptional({ type: [PriceTierDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriceTierDto)
  @IsOptional()
  tiers?: PriceTierDto[];
}
