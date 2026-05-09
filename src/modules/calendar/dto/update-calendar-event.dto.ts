import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ParticipantDto } from './participant.dto.js';

export class UpdateCalendarEventDto {
  @IsString() @IsOptional() @MaxLength(255) title?: string;
  @IsString() @IsOptional() @MaxLength(2000) description?: string;
  @IsDateString() @IsOptional() starts_at?: string;
  @IsDateString() @IsOptional() ends_at?: string;
  @IsBoolean() @IsOptional() all_day?: boolean;
  @IsUUID() @IsOptional() branch_id?: string;
  @IsUUID() @IsOptional() patient_id?: string;
  @IsUUID() @IsOptional() procedure_id?: string;
  @IsObject() @IsOptional() details?: Record<string, unknown>;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ParticipantDto)
  @IsOptional()
  participants?: ParticipantDto[];
}
