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

export class UpdateMedicalRepVisitDto {
  @IsUUID() @IsOptional() assigned_doctor_id?: string;
  @IsUUID() @IsOptional() branch_id?: string;
  @IsDateString() @IsOptional() scheduled_at?: string;
  @IsEnum(VisitPriority) @IsOptional() priority?: VisitPriority;
  @IsString() @IsOptional() @MaxLength(2000) notes?: string;

  @IsString() @IsOptional() @MaxLength(200) rep_full_name?: string;
  @IsString() @IsOptional() @MaxLength(50) rep_national_id?: string;
  @IsString() @IsOptional() @MaxLength(30) rep_phone_number?: string;
  @IsEmail() @IsOptional() @MaxLength(200) email?: string;
  @IsString() @IsOptional() @MaxLength(200) company_name?: string;

  @IsArray()
  @IsUUID('all', { each: true })
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsOptional()
  medication_ids?: string[];
}
