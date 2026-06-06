import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MaritalStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

/**
 * Patient-editable demographics. All fields optional (PATCH semantics).
 * `national_id` is intentionally absent — it is immutable once set.
 */
export class UpdatePatientProfileDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  full_name?: string;

  @ApiPropertyOptional({ description: 'ISO date, e.g. 1990-05-21' })
  @IsDateString()
  @IsOptional()
  date_of_birth?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  phone_number?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({
    enum: MaritalStatus,
    description:
      'SINGLE | MARRIED | DIVORCED | WIDOWED | SEPARATED | ENGAGED | UNKNOWN',
  })
  @IsEnum(MaritalStatus)
  @IsOptional()
  marital_status?: MaritalStatus;
}

export class PatientProfileDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  full_name!: string;

  @ApiProperty({ description: 'Read-only — immutable once set' })
  national_id!: string;

  @ApiProperty()
  date_of_birth!: Date;

  @ApiProperty()
  phone_number!: string;

  @ApiProperty()
  address!: string;

  @ApiProperty({ description: 'SINGLE | MARRIED | DIVORCED | WIDOWED | …' })
  marital_status!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Short-lived presigned GET URL for the avatar, or null',
  })
  profile_image_url!: string | null;
}
