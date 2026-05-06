import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { VisitPriority, VisitType } from '@prisma/client';

export class CreateVisitDto {
  @IsUUID() assigned_doctor_id: string;
  @IsUUID() @IsOptional() branch_id?: string;
  @IsEnum(VisitType) visit_type: VisitType;
  @IsEnum(VisitPriority) priority: VisitPriority;
  @IsDateString() scheduled_at: string;
  @IsString() @IsOptional() notes?: string;
}
