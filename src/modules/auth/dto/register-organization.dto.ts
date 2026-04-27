import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ScheduleDto } from '../../staff/dto/invite-staff.dto.js';

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

  @ApiPropertyOptional({ example: 'General Practitioner' })
  @IsOptional()
  @IsString()
  job_title?: string;

  @ApiPropertyOptional({ example: 'Cardiology' })
  @IsOptional()
  @IsString()
  specialty?: string;

  @ApiPropertyOptional({ type: ScheduleDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ScheduleDto)
  working_schedule?: ScheduleDto;
}
