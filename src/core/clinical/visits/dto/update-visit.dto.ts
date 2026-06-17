import {
  Equals,
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
  /**
   * SYSTEM discriminator. Immutable per visit, but the booking form template
   * the FE reuses for edit resubmits it. Accept-and-pin so the global
   * ValidationPipe (whitelist + forbidNonWhitelisted) doesn't 400 on it;
   * VisitsService.update re-injects 'PATIENT' for the template validator
   * regardless, so the value is never persisted from the patch.
   */
  @Equals('PATIENT') @IsOptional() visitor_type?: 'PATIENT';

  /**
   * SYSTEM discriminator. Optional on update because a visit cannot change
   * visitor_type after booking, but specialty may change if the assigned
   * doctor is reassigned. When supplied the validator enforces the same
   * predicates as on book.
   */
  @IsString() @IsOptional() @MaxLength(50) specialty_code?: string;

  /** Optional subspecialty; re-validated against the (final) assigned doctor. */
  @IsString() @IsOptional() @MaxLength(50) subspecialty_code?: string;

  @IsUUID() @IsOptional() assigned_doctor_id?: string;
  @IsUUID() @IsOptional() branch_id?: string;

  /**
   * Billable service for the visit. Not a Visit column — when this differs from
   * the service captured at booking, VisitsService.update triggers a booking-service
   * swap (void the old charge + invoice line, re-bill the new one), allowed only
   * while the case invoice is still unpaid.
   */
  @IsUUID() @IsOptional() service_id?: string;

  @IsEnum(AppointmentType) @IsOptional() appointment_type?: AppointmentType;
  @IsEnum(VisitPriority) @IsOptional() priority?: VisitPriority;
  @IsDateString() @IsOptional() scheduled_at?: string;

  @IsString() @IsOptional() @MaxLength(50) national_id?: string;
  @IsString() @IsOptional() @MaxLength(200) full_name?: string;
  @IsDateString() @IsOptional() date_of_birth?: string;
  @IsString() @IsOptional() @MaxLength(30) phone_number?: string;
  @IsString() @IsOptional() @MaxLength(200) address?: string;

  @IsEnum(MaritalStatus) @IsOptional() marital_status?: MaritalStatus;
}
