import { IsOptional, IsString, IsInt, Min, Max, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
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
  limit?: number = 20;
}
