import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DayOfWeek } from '@prisma/client';

export class WorkingShiftDto {
  @ApiProperty({ example: '09:00', description: 'HH:MM 24-hour format' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'start_time must be HH:MM format',
  })
  start_time!: string;

  @ApiProperty({ example: '17:00', description: 'HH:MM 24-hour format' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'end_time must be HH:MM format',
  })
  end_time!: string;
}

export class WorkingDayDto {
  @ApiProperty({ enum: DayOfWeek })
  @IsEnum(DayOfWeek)
  day_of_week!: DayOfWeek;

  @ApiProperty({ type: [WorkingShiftDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WorkingShiftDto)
  shifts!: WorkingShiftDto[];
}

export class BranchScheduleDto {
  @ApiProperty()
  @IsUUID('4')
  branch_id!: string;

  @ApiProperty({ type: [WorkingDayDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WorkingDayDto)
  days!: WorkingDayDto[];
}

export class UpdateStaffDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  first_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  last_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone_number?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  role_ids?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  branch_ids?: string[];

  @ApiPropertyOptional({
    type: [BranchScheduleDto],
    description:
      'Optional per-branch working schedule. Each branch_id must be present in the effective branch set.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BranchScheduleDto)
  schedule?: BranchScheduleDto[];
}

export class CreateStaffDto {
  @ApiProperty()
  @IsString()
  first_name!: string;

  @ApiProperty()
  @IsString()
  last_name!: string;

  @ApiProperty({ description: 'Phone number — used for OTP login' })
  @IsString()
  phone_number!: string;

  @ApiProperty({
    description: 'Min 8 chars. Admin shares this with the staff member.',
  })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  role_ids!: string[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  branch_ids!: string[];

  @ApiPropertyOptional({
    type: [BranchScheduleDto],
    description:
      'Optional per-branch working schedule. Each branch_id must be present in branch_ids.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BranchScheduleDto)
  schedule?: BranchScheduleDto[];
}
