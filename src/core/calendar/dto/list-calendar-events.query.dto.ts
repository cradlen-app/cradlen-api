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
  @ApiProperty({
    description:
      'Window start, ISO 8601 with timezone offset (server compares in UTC). Must be strictly before "to".',
  })
  @IsISO8601()
  from!: string;

  @ApiProperty({
    description:
      'Window end, ISO 8601 with timezone offset (server compares in UTC).',
  })
  @IsISO8601()
  to!: string;

  @ApiPropertyOptional({
    description:
      'Restrict to events owned by a specific profile. Visibility still applies: when querying another profile, only their ORGANIZATION-visible events on branches the caller can access are returned. Caller-owned PRIVATE events are never excluded.',
  })
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
