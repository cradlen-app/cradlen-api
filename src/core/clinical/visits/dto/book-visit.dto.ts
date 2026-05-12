import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { AppointmentType, VisitPriority } from '@prisma/client';
import { VisitIntakeFieldsDto } from './visit-intake.dto';

export class BookVisitDto extends VisitIntakeFieldsDto {
  @IsUUID() @IsOptional() patient_id?: string;

  @IsString() @IsOptional() national_id?: string;
  @IsString() @IsOptional() full_name?: string;
  @IsDateString() @IsOptional() date_of_birth?: string;
  @IsString() @IsOptional() phone_number?: string;
  @IsString() @IsOptional() address?: string;
  @IsBoolean() @IsOptional() is_married?: boolean;
  @IsString() @IsOptional() husband_name?: string;

  @IsUUID() assigned_doctor_id!: string;
  @IsEnum(AppointmentType) appointment_type!: AppointmentType;
  @IsEnum(VisitPriority) priority!: VisitPriority;
  @IsDateString() scheduled_at!: string;
  @IsUUID() @IsOptional() branch_id?: string;
}
