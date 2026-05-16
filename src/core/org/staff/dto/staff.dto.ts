import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { DayOfWeek, EngagementType, ExecutiveTitle } from '@prisma/client';

export const STAFF_ROLE_NAMES = [
  'OWNER',
  'BRANCH_MANAGER',
  'STAFF',
  'EXTERNAL',
] as const;
export const STAFF_LIST_ROLE_FILTERS = STAFF_ROLE_NAMES;
export type StaffRoleName = (typeof STAFF_ROLE_NAMES)[number];

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
    type: [String],
    description:
      'JobFunction codes (e.g. ["NURSE", "OBGYN"]). Codes must exist in the JobFunction table. Pass an empty array to clear all assigned job functions.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  job_function_codes?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Specialty codes from the Specialty table. Pass an empty array to clear all assigned specialties.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  specialty_codes?: string[];

  @ApiPropertyOptional({ enum: ExecutiveTitle, nullable: true })
  @IsOptional()
  @IsEnum(ExecutiveTitle)
  executive_title?: ExecutiveTitle | null;

  @ApiPropertyOptional({ enum: EngagementType })
  @IsOptional()
  @IsEnum(EngagementType)
  engagement_type?: EngagementType;

  @ApiPropertyOptional({
    type: [BranchScheduleDto],
    description:
      "Per-branch working schedule. Each entry replaces the schedule for its branch_id only — other branches' schedules are untouched. branch_id must be in the effective branch set.",
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
    type: [String],
    description:
      'JobFunction codes (e.g. ["NURSE", "OBGYN"]). Codes must exist in the JobFunction table.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  job_function_codes?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Specialty codes from the Specialty table.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  specialty_codes?: string[];

  @ApiPropertyOptional({ enum: ExecutiveTitle })
  @IsOptional()
  @IsEnum(ExecutiveTitle)
  executive_title?: ExecutiveTitle;

  @ApiPropertyOptional({ enum: EngagementType })
  @IsOptional()
  @IsEnum(EngagementType)
  engagement_type?: EngagementType;

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

export class ListStaffQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  branch_id?: string;

  @ApiPropertyOptional({ enum: STAFF_ROLE_NAMES })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 11, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    enum: ['org', 'mine'],
    description:
      'Listing scope. OWNER may pass "org" to see the full organization or "mine" to see only their assigned branches. Non-OWNER callers are always scoped to "mine" regardless of value.',
  })
  @IsOptional()
  @IsEnum(['org', 'mine'])
  scope?: 'org' | 'mine';

  @ApiPropertyOptional({
    description:
      'When true, filters to staff with at least one clinical job function (job_function.is_clinical = true). Includes nurses and assistants — for a doctor-only picker, use `doctors_only` instead.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @Transform(({ value }) => value === true || value === 'true')
  clinical?: boolean;

  @ApiPropertyOptional({
    description:
      'When true, filters to staff with at least one DOCTOR job function (OBGYN, ANESTHESIOLOGIST, PEDIATRICIAN, OTHER_DOCTOR). Excludes nurses and assistants. Takes precedence over `clinical` when both are true.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @Transform(({ value }) => value === true || value === 'true')
  doctors_only?: boolean;

  @ApiPropertyOptional({
    description:
      'Filters to staff whose ProfileSpecialty includes the given specialty code (e.g. "OBGYN"). Composes with `doctors_only` to narrow the book-visit doctor picker.',
  })
  @IsOptional()
  @IsString()
  specialty_code?: string;

  @ApiPropertyOptional({
    description:
      "Free-text search across the staff member's first_name, last_name, email, and phone_number (case-insensitive substring match).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Filter to staff with at least one of the given JobFunction codes (e.g. ["NURSE","RECEPTIONIST"]). Accepts a comma-separated string or repeated query params. Composes (AND) with `clinical` / `doctors_only`.',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value as unknown[];
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return value as unknown;
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  job_function_codes?: string[];

  @ApiPropertyOptional({ enum: EngagementType })
  @IsOptional()
  @IsEnum(EngagementType)
  engagement_type?: EngagementType;

  @ApiPropertyOptional({ enum: ExecutiveTitle })
  @IsOptional()
  @IsEnum(ExecutiveTitle)
  executive_title?: ExecutiveTitle;
}

class RoleSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

class BranchSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() city!: string;
  @ApiProperty() governorate!: string;
}

class JobFunctionSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() is_clinical!: boolean;
}

class SpecialtySummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
}

class ScheduleShiftSummaryDto {
  @ApiProperty() start_time!: string;
  @ApiProperty() end_time!: string;
}

class ScheduleDaySummaryDto {
  @ApiProperty({ enum: DayOfWeek }) day_of_week!: DayOfWeek;
  @ApiProperty({ type: [ScheduleShiftSummaryDto] })
  shifts!: ScheduleShiftSummaryDto[];
}

class ScheduleSummaryDto {
  @ApiProperty() branch_id!: string;
  @ApiProperty({ type: [ScheduleDaySummaryDto] })
  days!: ScheduleDaySummaryDto[];
}

export class StaffResponseDto {
  @ApiProperty() profile_id!: string;
  @ApiProperty() user_id!: string;
  @ApiProperty() first_name!: string;
  @ApiProperty() last_name!: string;
  @ApiProperty({ nullable: true }) email!: string | null;
  @ApiProperty({ nullable: true }) phone_number!: string | null;
  @ApiPropertyOptional({ enum: ExecutiveTitle, nullable: true })
  executive_title!: ExecutiveTitle | null;
  @ApiProperty({ enum: EngagementType }) engagement_type!: EngagementType;
  @ApiProperty({ type: [RoleSummaryDto] }) roles!: RoleSummaryDto[];
  @ApiProperty({ type: [BranchSummaryDto] }) branches!: BranchSummaryDto[];
  @ApiProperty({ type: [JobFunctionSummaryDto] })
  job_functions!: JobFunctionSummaryDto[];
  @ApiProperty({ type: [SpecialtySummaryDto] })
  specialties!: SpecialtySummaryDto[];
  @ApiProperty({ type: [ScheduleSummaryDto] })
  schedule!: ScheduleSummaryDto[];
}

export class CreateStaffResponseDto {
  @ApiProperty() user_id!: string;
  @ApiProperty() profile_id!: string;
  @ApiProperty() organization_id!: string;
  @ApiProperty({
    description: 'Auto-generated system email for the staff login',
  })
  generated_email!: string;
}
