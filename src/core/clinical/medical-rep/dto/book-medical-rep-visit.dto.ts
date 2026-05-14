import {
  ArrayMaxSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { VisitPriority } from '@prisma/client';

/**
 * Discriminated payload:
 *   - existing rep: pass `medical_rep_id` and omit identity fields.
 *   - new rep: pass rep_full_name + company_name (+ optional rep_national_id,
 *     rep_phone_number, email) and the service upserts the MedicalRep row.
 *
 * The service rejects mixed payloads (identity fields + medical_rep_id) with
 * 400 so a broken frontend cannot leak a half-typed identity over an existing
 * rep.
 */
export class BookMedicalRepVisitDto {
  /**
   * SYSTEM discriminator pinned to MEDICAL_REP. Enables the server-side
   * TemplateValidator to evaluate visitor_type-keyed predicates against the
   * same `book_visit` shell shared with patient bookings.
   */
  @Equals('MEDICAL_REP') visitor_type!: 'MEDICAL_REP';

  @IsUUID() @IsOptional() medical_rep_id?: string;

  @IsString() @IsOptional() @MaxLength(200) rep_full_name?: string;
  @IsString() @IsOptional() @MaxLength(50) rep_national_id?: string;
  @IsString() @IsOptional() @MaxLength(30) rep_phone_number?: string;
  @IsEmail() @IsOptional() @MaxLength(200) email?: string;
  @IsString() @IsOptional() @MaxLength(200) company_name?: string;

  @IsUUID() assigned_doctor_id!: string;
  @IsUUID() @IsOptional() branch_id?: string;
  @IsDateString() scheduled_at!: string;
  @IsEnum(VisitPriority) @IsOptional() priority?: VisitPriority;

  @IsArray()
  @IsUUID('all', { each: true })
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsOptional()
  medication_ids?: string[];

  @IsString() @IsOptional() @MaxLength(2000) notes?: string;
}
