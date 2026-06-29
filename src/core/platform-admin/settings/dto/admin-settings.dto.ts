import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class AdminSettingsDto {
  @ApiPropertyOptional({ nullable: true }) instapay_handle!: string | null;
  @ApiPropertyOptional({ nullable: true }) wallet_number!: string | null;
  @ApiProperty() free_trial_days!: number;
  @ApiProperty() auto_verify_gateway_payments!: boolean;
  @ApiProperty() default_currency!: string;
}

/** Partial update — every field optional; only provided keys are written. */
export class UpdateAdminSettingsDto {
  @ApiPropertyOptional({ nullable: true })
  @IsString()
  @IsOptional()
  instapay_handle?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsString()
  @IsOptional()
  wallet_number?: string | null;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  @IsOptional()
  free_trial_days?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  auto_verify_gateway_payments?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  default_currency?: string;
}
