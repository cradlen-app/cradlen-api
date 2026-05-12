import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AppointmentType, VisitPriority } from '@prisma/client';
import { VisitIntakeFieldsDto } from './visit-intake.dto';

export class UpdateVisitDto extends VisitIntakeFieldsDto {
  @IsUUID() @IsOptional() assigned_doctor_id?: string;
  @IsUUID() @IsOptional() branch_id?: string;
  @IsEnum(AppointmentType) @IsOptional() appointment_type?: AppointmentType;
  @IsEnum(VisitPriority) @IsOptional() priority?: VisitPriority;
  @IsDateString() @IsOptional() scheduled_at?: string;
}
