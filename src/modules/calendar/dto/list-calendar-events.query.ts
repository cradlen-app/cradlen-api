import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { CalendarEventType } from '@prisma/client';

export class ListCalendarEventsQueryDto {
  @IsDateString() from!: string;
  @IsDateString() to!: string;
  @IsUUID() @IsOptional() branch_id?: string;
  @IsUUID() @IsOptional() doctor_id?: string;
  @IsUUID() @IsOptional() patient_id?: string;
  @IsEnum(CalendarEventType) @IsOptional() type?: CalendarEventType;
}
