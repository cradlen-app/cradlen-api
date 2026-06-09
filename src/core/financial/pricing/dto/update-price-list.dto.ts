import { ApiPropertyOptional } from '@nestjs/swagger';
import { DiscountType } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdatePriceListDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  is_default?: boolean;

  @ApiPropertyOptional({ enum: DiscountType, nullable: true })
  @IsEnum(DiscountType)
  @IsOptional()
  discount_type?: DiscountType | null;

  @ApiPropertyOptional({ nullable: true })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  discount_value?: number | null;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  valid_from?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  valid_to?: string;
}
