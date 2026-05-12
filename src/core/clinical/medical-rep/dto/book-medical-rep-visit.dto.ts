import {
  ArrayMaxSize,
  ArrayUnique,
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
 *   - new rep: pass full_name + company_name (+ optional national_id, phone,
 *     email) and the service upserts the MedicalRep row.
 *
 * The service rejects mixed payloads (identity fields + medical_rep_id) with
 * 400 so a broken frontend cannot leak a half-typed identity over an existing
 * rep.
 */
export class BookMedicalRepVisitDto {
  @IsUUID() @IsOptional() medical_rep_id?: string;

  @IsString() @IsOptional() @MaxLength(200) full_name?: string;
  @IsString() @IsOptional() @MaxLength(50) national_id?: string;
  @IsString() @IsOptional() @MaxLength(30) phone_number?: string;
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
