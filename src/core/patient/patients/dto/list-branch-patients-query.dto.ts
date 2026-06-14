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
   * When true, restricts the directory to patients whose qualifying checked-in
   * visit at the branch was assigned to the current doctor (their own patients).
   */
  @IsOptional()
  @Type(() => Boolean)
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  assigned_to_me?: boolean;
}
