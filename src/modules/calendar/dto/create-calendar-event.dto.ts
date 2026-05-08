import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CalendarEventType } from '@prisma/client';
import { ParticipantDto } from './participant.dto.js';

export class CreateCalendarEventDto {
  @IsEnum(CalendarEventType) type!: CalendarEventType;
  @IsString() @MaxLength(255) title!: string;
  @IsString() @IsOptional() @MaxLength(2000) description?: string;
  @IsDateString() starts_at!: string;
  @IsDateString() ends_at!: string;
  @IsBoolean() @IsOptional() all_day?: boolean;
  @IsUUID() @IsOptional() branch_id?: string;
  @IsUUID() @IsOptional() patient_id?: string;
  @IsObject() @IsOptional() details?: Record<string, unknown>;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ParticipantDto)
  @IsOptional()
  participants?: ParticipantDto[];
}
