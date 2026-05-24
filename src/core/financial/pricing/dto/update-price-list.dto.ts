import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';

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

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  valid_from?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  valid_to?: string;
}
