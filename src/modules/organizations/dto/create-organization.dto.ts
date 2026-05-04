import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateOrganizationDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  organization_name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  specialties?: string[];

  @ApiProperty()
  @IsString()
  @MinLength(1)
  branch_name!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  branch_address!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  branch_city!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  branch_governorate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branch_country?: string;

  @ApiProperty({ type: [String], example: ['OWNER'] })
  @IsArray()
  @ArrayMinSize(1)
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
