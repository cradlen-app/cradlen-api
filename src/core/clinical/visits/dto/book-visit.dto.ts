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

export class BookVisitDto extends VisitIntakeFieldsDto {
  @IsUUID() @IsOptional() patient_id?: string;

  @IsString() @IsOptional() national_id?: string;
  @IsString() @IsOptional() full_name?: string;
  @IsDateString() @IsOptional() date_of_birth?: string;
  @IsString() @IsOptional() phone_number?: string;
  @IsString() @IsOptional() address?: string;

  /** Legacy fields kept for backward compatibility; new clients should use marital_status + spouse_* instead. */
  @IsBoolean() @IsOptional() is_married?: boolean;
  @IsString() @IsOptional() husband_name?: string;

  @IsEnum(MaritalStatus) @IsOptional() marital_status?: MaritalStatus;
  @IsString() @IsOptional() @MaxLength(200) spouse_full_name?: string;
  @IsString() @IsOptional() @MaxLength(50) spouse_national_id?: string;
  @IsString() @IsOptional() @MaxLength(30) spouse_phone_number?: string;

  @IsUUID() assigned_doctor_id!: string;
  @IsEnum(AppointmentType) appointment_type!: AppointmentType;
  @IsEnum(VisitPriority) priority!: VisitPriority;
  @IsDateString() scheduled_at!: string;
  @IsUUID() @IsOptional() branch_id?: string;
}
