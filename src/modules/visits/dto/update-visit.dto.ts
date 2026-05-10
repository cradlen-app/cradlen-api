import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { VisitPriority, VisitType } from '@prisma/client';
import { VisitIntakeFieldsDto } from './visit-intake.dto';

export class UpdateVisitDto extends VisitIntakeFieldsDto {
  @IsUUID() @IsOptional() assigned_doctor_id?: string;
  @IsUUID() @IsOptional() branch_id?: string;
  @IsEnum(VisitType) @IsOptional() visit_type?: VisitType;
  @IsEnum(VisitPriority) @IsOptional() priority?: VisitPriority;
  @IsDateString() @IsOptional() scheduled_at?: string;
}
