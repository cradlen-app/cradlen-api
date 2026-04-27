import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class RegisterOrganizationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  registration_token!: string;

  @ApiProperty({ example: 'Cradlen Clinic' })
  @IsString()
  @MinLength(1)
  organization_name!: string;

  @ApiPropertyOptional({ example: ['Cardiology', 'Dermatology'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  organization_specialities?: string[];

  @ApiProperty({ example: '123 Main St' })
  @IsString()
  @IsNotEmpty()
  branch_address!: string;

  @ApiProperty({ example: 'Cairo' })
  @IsString()
  @IsNotEmpty()
  branch_city!: string;

  @ApiProperty({ example: 'Giza' })
  @IsString()
  @IsNotEmpty()
  branch_governorate!: string;

  @ApiProperty({ example: 'Egypt' })
  @IsString()
  @IsNotEmpty()
  branch_country!: string;

  @ApiProperty({ example: false })
  @IsBoolean()
  is_clinical!: boolean;

  @ApiPropertyOptional({ example: 'Cardiology' })
  @IsOptional()
  @IsString()
  speciality?: string;

  @ApiPropertyOptional({ example: 'General Practitioner' })
  @IsOptional()
  @IsString()
  job_title?: string;
}
