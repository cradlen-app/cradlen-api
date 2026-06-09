import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DiscountType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { PriceTierDto } from './price-tier.dto.js';

export class UpdatePriceListItemDto {
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  unit_price?: number;

  @ApiPropertyOptional({ enum: DiscountType, nullable: true })
  @IsEnum(DiscountType)
  @IsOptional()
  discount_type?: DiscountType | null;

  @ApiPropertyOptional({ nullable: true })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  discount_value?: number | null;

  @ApiPropertyOptional({
    type: [PriceTierDto],
    description: 'When provided, replaces the full tier set for this item.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriceTierDto)
  @IsOptional()
  tiers?: PriceTierDto[];
}
