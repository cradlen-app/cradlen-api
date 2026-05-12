import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EngagementType, ExecutiveTitle } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class SignupCompleteDto {
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

  @ApiProperty({ example: 'Main Branch' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  branch_name!: string;

  @ApiProperty({ example: '123 Main St' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  branch_address!: string;

  @ApiProperty({ example: 'Cairo' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  branch_city!: string;

  @ApiProperty({ example: 'Giza' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  branch_governorate!: string;

  @ApiPropertyOptional({ example: 'Egypt' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  branch_country?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'JobFunction codes (e.g. ["OBGYN"]). Drives staff filtering and function-aware authorization. Codes must exist in the JobFunction table.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  job_function_codes?: string[];

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
