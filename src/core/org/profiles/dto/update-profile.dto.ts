import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsOptional,
  IsString,
  Length,
  MaxLength,
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

  /**
   * USER-LEVEL — shared across the user's profiles. ISO date string; pass
   * null to clear.
   */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  date_of_birth?: string | null;

  /**
   * PROFILE-LEVEL — free-text title shown on the profile (e.g.
   * "استشاري النساء والتوليد"). Display only. Empty string clears it.
   */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(120)
  professional_title?: string | null;
}
