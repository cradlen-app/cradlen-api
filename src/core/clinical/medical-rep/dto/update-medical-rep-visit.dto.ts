import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
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

  @IsArray()
  @IsUUID('all', { each: true })
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsOptional()
  medication_ids?: string[];
}
