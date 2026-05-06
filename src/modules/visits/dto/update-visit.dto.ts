import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { VisitPriority, VisitType } from '@prisma/client';

export class UpdateVisitDto {
  @IsUUID() @IsOptional() assigned_doctor_id?: string;
  @IsUUID() @IsOptional() branch_id?: string;
  @IsEnum(VisitType) @IsOptional() visit_type?: VisitType;
  @IsEnum(VisitPriority) @IsOptional() priority?: VisitPriority;
  @IsDateString() @IsOptional() scheduled_at?: string;
  @IsString() @IsOptional() notes?: string;
}
