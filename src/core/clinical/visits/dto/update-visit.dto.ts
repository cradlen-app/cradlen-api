import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AppointmentType, MaritalStatus, VisitPriority } from '@prisma/client';
import { VisitIntakeFieldsDto } from './visit-intake.dto';

export class UpdateVisitDto extends VisitIntakeFieldsDto {
  @IsUUID() @IsOptional() assigned_doctor_id?: string;
  @IsUUID() @IsOptional() branch_id?: string;
  @IsEnum(AppointmentType) @IsOptional() appointment_type?: AppointmentType;
  @IsEnum(VisitPriority) @IsOptional() priority?: VisitPriority;
  @IsDateString() @IsOptional() scheduled_at?: string;

  @IsString() @IsOptional() @MaxLength(50) national_id?: string;
  @IsString() @IsOptional() @MaxLength(200) full_name?: string;
  @IsDateString() @IsOptional() date_of_birth?: string;
  @IsString() @IsOptional() @MaxLength(30) phone_number?: string;
  @IsString() @IsOptional() @MaxLength(200) address?: string;

  @IsBoolean() @IsOptional() is_married?: boolean;
  @IsString() @IsOptional() @MaxLength(200) husband_name?: string;

  @IsEnum(MaritalStatus) @IsOptional() marital_status?: MaritalStatus;
  @IsString() @IsOptional() @MaxLength(200) spouse_full_name?: string;
  @IsString() @IsOptional() @MaxLength(50) spouse_national_id?: string;
  @IsString() @IsOptional() @MaxLength(30) spouse_phone_number?: string;
  @IsUUID() @IsOptional() spouse_guardian_id?: string;
}
