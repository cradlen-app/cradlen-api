import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  EngagementType,
  ExecutiveTitle,
  InvitationStatus,
} from '@prisma/client';
import { BranchScheduleDto } from '../../staff/dto/staff.dto.js';

export class PreviewInvitationQueryDto {
  @ApiProperty()
  @IsUUID('4')
  invitation_id!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token!: string;
}

// ---------- Shared nested DTOs (mapper output shape) ----------

export class InvitationRoleDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class InvitationBranchDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  city!: string;

  @ApiProperty()
  governorate!: string;
}

export class InvitationJobFunctionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;
}

export class InvitationSpecialtyDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;
}

export class InvitationInvitedByDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  first_name!: string;

  @ApiProperty()
  last_name!: string;

  @ApiProperty()
  email!: string;
}

export class InvitationWorkingScheduleBranchDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class InvitationShiftDto {
  @ApiProperty({ description: 'HH:mm' })
  start_time!: string;

  @ApiProperty({ description: 'HH:mm' })
  end_time!: string;
}

export class InvitationDayDto {
  @ApiProperty()
  day_of_week!: string;

  @ApiProperty({ type: () => [InvitationShiftDto] })
  shifts!: InvitationShiftDto[];
}

export class InvitationWorkingScheduleDto {
  @ApiProperty({ type: () => InvitationWorkingScheduleBranchDto })
  branch!: InvitationWorkingScheduleBranchDto;

  @ApiProperty({ type: () => [InvitationDayDto] })
  days!: InvitationDayDto[];
}

// ---------- Management response (create / get / list / cancel) ----------

export class InvitationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organization_id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  first_name!: string;

  @ApiProperty()
  last_name!: string;

  @ApiPropertyOptional({ nullable: true })
  phone_number!: string | null;

  @ApiPropertyOptional({ enum: ExecutiveTitle, nullable: true })
  executive_title!: ExecutiveTitle | null;

  @ApiProperty({ enum: EngagementType })
  engagement_type!: EngagementType;

  @ApiProperty({ enum: InvitationStatus })
  status!: InvitationStatus;

  @ApiProperty()
  invited_at!: Date;

  @ApiProperty()
  expires_at!: Date;

  @ApiPropertyOptional({ nullable: true })
  accepted_at!: Date | null;

  @ApiProperty({ type: () => InvitationInvitedByDto })
  invited_by!: InvitationInvitedByDto;

  @ApiProperty({ type: () => [InvitationRoleDto] })
  roles!: InvitationRoleDto[];

  @ApiProperty({ type: () => [InvitationBranchDto] })
  branches!: InvitationBranchDto[];

  @ApiProperty({ type: () => [InvitationJobFunctionDto] })
  job_functions!: InvitationJobFunctionDto[];

  @ApiProperty({ type: () => [InvitationSpecialtyDto] })
  specialties!: InvitationSpecialtyDto[];

  @ApiPropertyOptional({
    type: () => [InvitationWorkingScheduleDto],
    nullable: true,
    description:
      'Present (possibly null) only on GET invitation detail for ACCEPTED invitations.',
  })
  working_schedule?: InvitationWorkingScheduleDto[] | null;
}

// ---------- Preview (public) ----------

export class InvitationPreviewOrganizationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class InvitationPreviewInvitedByDto {
  @ApiProperty()
  first_name!: string;

  @ApiProperty()
  last_name!: string;
}

export class InvitationPreviewResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: InvitationStatus })
  status!: InvitationStatus;

  @ApiProperty()
  expires_at!: Date;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  first_name!: string;

  @ApiProperty()
  last_name!: string;

  @ApiPropertyOptional({ enum: ExecutiveTitle, nullable: true })
  executive_title!: ExecutiveTitle | null;

  @ApiProperty({ enum: EngagementType })
  engagement_type!: EngagementType;

  @ApiProperty({ type: () => InvitationPreviewOrganizationDto })
  organization!: InvitationPreviewOrganizationDto;

  @ApiProperty({ type: () => InvitationPreviewInvitedByDto })
  invited_by!: InvitationPreviewInvitedByDto;

  @ApiProperty({ type: () => [InvitationRoleDto] })
  roles!: InvitationRoleDto[];

  @ApiProperty({ type: () => [InvitationBranchDto] })
  branches!: InvitationBranchDto[];

  @ApiProperty({ type: () => [InvitationJobFunctionDto] })
  job_functions!: InvitationJobFunctionDto[];

  @ApiProperty({ type: () => [InvitationSpecialtyDto] })
  specialties!: InvitationSpecialtyDto[];
}

// ---------- Decline / Accept request DTOs (in-bound) ----------

export class DeclineInvitationDto {
  @ApiProperty()
  @IsUUID('4')
  invitation_id!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class CreateInvitationDto {
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  first_name!: string;

  @ApiProperty()
  @IsString()
  last_name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone_number?: string;

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

  @ApiPropertyOptional({
    description:
      'Free-text professional title shown on the profile (e.g. "استشاري النساء والتوليد"). Display only — does not drive authorization or filtering. Carried onto the profile when the invitation is accepted.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(120)
  professional_title?: string;

  @ApiPropertyOptional({ enum: EngagementType })
  @IsOptional()
  @IsEnum(EngagementType)
  engagement_type?: EngagementType;
}

export class AcceptInvitationDto {
  @ApiProperty()
  @IsUUID('4')
  invitation_id!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  first_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  last_name?: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiPropertyOptional({
    type: [BranchScheduleDto],
    description:
      "Optional per-branch working schedule. branch_id must be one of the invitation's assigned branches.",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BranchScheduleDto)
  schedule?: BranchScheduleDto[];
}

// ---------- Accept response ----------

export class AcceptInvitationResponseDto {
  @ApiProperty()
  user_id!: string;

  @ApiProperty()
  profile_id!: string;

  @ApiProperty()
  organization_id!: string;
}
