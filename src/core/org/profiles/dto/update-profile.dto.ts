import { ApiPropertyOptional } from '@nestjs/swagger';
import { EngagementType, ExecutiveTitle } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  first_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  last_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone_number?: string;

  @ApiPropertyOptional({ enum: ExecutiveTitle, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsEnum(ExecutiveTitle)
  executive_title?: ExecutiveTitle | null;

  @ApiPropertyOptional({ enum: EngagementType })
  @IsOptional()
  @IsEnum(EngagementType)
  engagement_type?: EngagementType;

  @ApiPropertyOptional({
    type: [String],
    description:
      'JobFunction codes (e.g. ["OBGYN"]). Replaces the current set when provided. Empty array clears all.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  job_function_codes?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Specialty codes or names (case-insensitive). Replaces the current set when provided. Empty array clears all.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  specialty_codes?: string[];
}
