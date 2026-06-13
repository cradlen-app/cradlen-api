import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { VisitStatus } from '@prisma/client';

export class ListVisitsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number =
    20;
}

export class ListBranchVisitsQueryDto {
  @IsNotEmpty() @IsEnum(VisitStatus) status!: VisitStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number =
    20;
}

export class VisitHistoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number =
    3;
  @IsOptional() @IsUUID() exclude?: string;
}

export class VitalsTrendQueryDto {
  @IsOptional() @IsUUID() exclude?: string;
}

export class VisitTodayStatsQueryDto {
  @ApiPropertyOptional({
    description:
      'Day to count (ISO date). Defaults to today. Counted by scheduled_at within the day bounds.',
  })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({
    description:
      'When true, counts only visits assigned to the current doctor (their own queue).',
  })
  @IsOptional()
  @Type(() => Boolean)
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  assigned_to_me?: boolean;
}
