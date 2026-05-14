import { CalendarEventType, CalendarVisibility } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ListCalendarEventsQueryDto {
  @ApiProperty({ description: 'Window start (ISO 8601)' })
  @IsISO8601()
  from!: string;

  @ApiProperty({ description: 'Window end (ISO 8601)' })
  @IsISO8601()
  to!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  profile_id?: string;

  @ApiPropertyOptional({ enum: CalendarEventType })
  @IsOptional()
  @IsEnum(CalendarEventType)
  event_type?: CalendarEventType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @ApiPropertyOptional({ enum: CalendarVisibility })
  @IsOptional()
  @IsEnum(CalendarVisibility)
  visibility?: CalendarVisibility;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}
