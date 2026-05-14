import {
  Equals,
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
  /**
   * SYSTEM discriminator from the form template. The PATIENT booking endpoint
   * only accepts `PATIENT`; medical-rep bookings go through their own endpoint.
   * Pinned here so the server-side TemplateValidator can enforce
   * visitor_type-keyed predicates against the submitted payload.
   */
  @Equals('PATIENT') visitor_type!: 'PATIENT';

  /**
   * SYSTEM discriminator selecting which form-template extension's clinical
   * intake applies (e.g. `OBGYN`). Required by the template under
   * visitor_type=PATIENT; consistency vs. the assigned doctor's specialties
   * is enforced server-side.
   */
  @IsString() @MaxLength(50) specialty_code!: string;

  /**
   * Optional CarePath code (e.g. `OBGYN_PREGNANCY`). When provided, the
   * resulting PatientJourney is anchored to that care path so downstream
   * specialty flows (pregnancy records, etc.) can gate on it.
   */
  @IsString() @MaxLength(80) @IsOptional() care_path_code?: string;

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
  @IsUUID() @IsOptional() spouse_guardian_id?: string;

  @IsUUID() assigned_doctor_id!: string;
  @IsEnum(AppointmentType) appointment_type!: AppointmentType;
  @IsEnum(VisitPriority) priority!: VisitPriority;
  @IsDateString() scheduled_at!: string;
  @IsUUID() @IsOptional() branch_id?: string;
}
