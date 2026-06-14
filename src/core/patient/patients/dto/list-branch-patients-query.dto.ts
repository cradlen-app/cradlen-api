import {
  IsBoolean,
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  IsEnum,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { JourneyStatus, JourneyTemplateType } from '@prisma/client';

export class ListBranchPatientsQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsEnum(JourneyStatus) journey_status?: JourneyStatus;
  @IsOptional() @IsEnum(JourneyTemplateType) journey_type?: JourneyTemplateType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 11;

  /**
   * Deprecated/ignored: scope is derived server-side from the caller role (a
   * doctor always sees only their own patients). Accepted for backward-compat.
   */
  @IsOptional()
  @Type(() => Boolean)
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  assigned_to_me?: boolean;
}
