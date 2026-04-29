import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class SignupCompleteDto {
  @ApiProperty()
  @IsString()
  signup_token!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  account_name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  account_specialities?: string[];

  @ApiProperty({ example: 'Main Branch' })
  @IsString()
  branch_name!: string;

  @ApiProperty()
  @IsString()
  branch_address!: string;

  @ApiProperty()
  @IsString()
  branch_city!: string;

  @ApiProperty()
  @IsString()
  branch_governorate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branch_country?: string;

  @ApiProperty()
  @IsBoolean()
  is_clinical!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specialty?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  job_title?: string;
}
