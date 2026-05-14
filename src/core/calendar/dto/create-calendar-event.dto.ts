import { CalendarEventType, CalendarVisibility } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCalendarEventDto {
  @ApiProperty({ enum: CalendarEventType })
  @IsEnum(CalendarEventType)
  event_type!: CalendarEventType;

  @ApiPropertyOptional({ enum: CalendarVisibility })
  @IsOptional()
  @IsEnum(CalendarVisibility)
  visibility?: CalendarVisibility;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ description: 'ISO 8601 datetime' })
  @IsISO8601()
  start_at!: string;

  @ApiProperty({ description: 'ISO 8601 datetime' })
  @IsISO8601()
  end_at!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  all_day?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @ApiPropertyOptional({ description: 'Required when event_type is PROCEDURE' })
  @IsOptional()
  @IsUUID()
  procedure_id?: string;

  @ApiPropertyOptional({ description: 'Optional, only valid for PROCEDURE' })
  @IsOptional()
  @IsUUID()
  patient_id?: string;

  @ApiPropertyOptional({
    description:
      'Assistant doctor profile IDs (only valid for PROCEDURE events). Replaces the existing set on update.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  assistant_profile_ids?: string[];
}
