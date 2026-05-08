import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';

export class SurgeryDetailsDto {
  @IsString() @MaxLength(255) surgery_name!: string;
  @IsString() @IsOptional() @MaxLength(255) surgery_type?: string;
  @IsString() @IsOptional() @MaxLength(255) operating_room?: string;
  @IsString() @IsOptional() @MaxLength(2000) pre_op_notes?: string;
  @IsInt() @Min(1) @IsOptional() expected_duration_minutes?: number;
}

export class MeetingDetailsDto {
  @IsString() @IsOptional() @MaxLength(255) location?: string;
  @IsUrl() @IsOptional() virtual_link?: string;
  @IsString() @IsOptional() @MaxLength(2000) agenda?: string;
}

export class LeaveDetailsDto {
  @IsString() @IsOptional() @MaxLength(500) reason?: string;
}

export class PersonalDetailsDto {}
