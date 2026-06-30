import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MaritalStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import {
  NATIONAL_ID_MESSAGE,
  NATIONAL_ID_REGEX,
} from '../../../auth/dto/national-id.constant.js';

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

/**
 * Patient self-service national-ID change. National ID is the login credential,
 * so the current password is re-verified before it is written. The format rule
 * is the shared 14-digit Egyptian one used by signup/login. Uniqueness is
 * enforced by the DB (`@unique`) and surfaces as a 409 via the global filter.
 */
export class UpdateNationalIdDto {
  @ApiProperty({ description: 'New national ID — exactly 14 digits' })
  @IsString()
  @Matches(NATIONAL_ID_REGEX, { message: NATIONAL_ID_MESSAGE })
  national_id!: string;

  @ApiProperty({ description: 'Current account password (re-authentication)' })
  @IsString()
  @IsNotEmpty()
  current_password!: string;
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
