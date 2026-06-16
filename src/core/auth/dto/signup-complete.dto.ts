import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EngagementType, ExecutiveTitle } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { BranchInputFieldsDto } from '@core/org/branches/dto/branch-input-fields.dto.js';

export class SignupCompleteDto extends BranchInputFieldsDto {
  @ApiProperty()
  @IsString()
  signup_token!: string;

  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  organization_name!: string;

  @ApiProperty({ type: [String] })
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((item: unknown) =>
          typeof item === 'string' ? item.trim() : item,
        )
      : value,
  )
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  specialties!: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      "The owner's own clinical specialties, set only when the owner also practices as a doctor. Distinct from `specialties`, which describes what the organization offers.",
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((item: unknown) =>
          typeof item === 'string' ? item.trim() : item,
        )
      : value,
  )
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  practitioner_specialties?: string[];

  @ApiPropertyOptional({
    description:
      'JobFunction code (e.g. "DOCTOR"). Drives staff filtering and function-aware authorization. Must exist in the JobFunction table.',
  })
  @IsOptional()
  @IsString()
  job_function_code?: string;

  @ApiPropertyOptional({
    description:
      'Free-text professional title shown on the profile (e.g. "استشاري النساء والتوليد"). Display/governance only — does not drive authorization or filtering.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(120)
  professional_title?: string;

  @ApiPropertyOptional({
    enum: ExecutiveTitle,
    description:
      'C-suite title at this organization. Display/governance only — does not grant permissions.',
  })
  @IsOptional()
  @IsEnum(ExecutiveTitle)
  executive_title?: ExecutiveTitle;

  @ApiPropertyOptional({
    enum: EngagementType,
    description: 'Engagement model. Defaults to FULL_TIME if omitted.',
  })
  @IsOptional()
  @IsEnum(EngagementType)
  engagement_type?: EngagementType;
}
