import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
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

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  specialties!: string[];

  @ApiProperty({ example: 'Main Branch' })
  @IsString()
  branch_name!: string;

  @ApiProperty({ example: '123 Main St' })
  @IsString()
  @MinLength(1)
  branch_address!: string;

  @ApiProperty({ example: 'Cairo' })
  @IsString()
  @MinLength(1)
  branch_city!: string;

  @ApiProperty({ example: 'Giza' })
  @IsString()
  @MinLength(1)
  branch_governorate!: string;

  @ApiPropertyOptional({ example: 'Egypt' })
  @IsOptional()
  @IsString()
  branch_country?: string;

  @ApiProperty({ type: [String], example: ['OWNER', 'DOCTOR'] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsIn(['OWNER', 'DOCTOR'], { each: true })
  roles!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specialty?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  job_title?: string;
}
