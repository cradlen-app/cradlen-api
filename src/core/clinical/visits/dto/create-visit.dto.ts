import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { VisitPriority, VisitType } from '@prisma/client';
import { VisitIntakeFieldsDto } from './visit-intake.dto';

export class CreateVisitDto extends VisitIntakeFieldsDto {
  @IsUUID() assigned_doctor_id!: string;
  @IsUUID() @IsOptional() branch_id?: string;
  @IsEnum(VisitType) visit_type!: VisitType;
  @IsEnum(VisitPriority) priority!: VisitPriority;
  @IsDateString() scheduled_at!: string;
}
