import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
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
  invitation!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token!: string;
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

  @ApiProperty({
    type: [Object],
    description: 'JobFunction { id, code, name } pairs',
  })
  job_functions!: { id: string; code: string; name: string }[];

  @ApiProperty({
    type: [Object],
    description: 'Specialty { id, code, name } pairs',
  })
  specialties!: { id: string; code: string; name: string }[];

  @ApiProperty()
  organization!: { id: string; name: string };

  @ApiProperty()
  invited_by!: { first_name: string; last_name: string };

  @ApiProperty()
  roles!: { id: string; name: string }[];

  @ApiProperty()
  branches!: { id: string; name: string; city: string; governorate: string }[];
}

export class DeclineInvitationDto {
  @ApiProperty()
  @IsUUID('4')
  invitation!: string;

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

  @ApiPropertyOptional({ enum: EngagementType })
  @IsOptional()
  @IsEnum(EngagementType)
  engagement_type?: EngagementType;
}

export class BulkCreateInvitationsDto {
  @ApiProperty({ type: [CreateInvitationDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateInvitationDto)
  invitations!: CreateInvitationDto[];
}

export class AcceptInvitationDto {
  @ApiProperty()
  @IsUUID()
  invitation_id!: string;

  @ApiProperty()
  @IsString()
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
