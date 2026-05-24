import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateProviderPriceOverrideDto {
  @ApiProperty()
  @IsUUID()
  service_id!: string;

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  branch_id?: string;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ default: 'EGP' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  valid_from?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  valid_to?: string;
}
