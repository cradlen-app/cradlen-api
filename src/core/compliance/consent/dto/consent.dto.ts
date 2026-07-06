import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ConsentStatus, ConsentType } from '@prisma/client';

export class GrantConsentDto {
  @ApiProperty({ enum: ConsentType })
  @IsEnum(ConsentType)
  type!: ConsentType;

  @ApiProperty({
    description:
      'Version/identifier of the consent text presented to the patient at capture.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  consent_version!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  note?: string;
}

export class WithdrawConsentDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  note?: string;
}

export class ConsentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  patient_id!: string;

  @ApiProperty()
  organization_id!: string;

  @ApiProperty({ enum: ConsentType })
  type!: ConsentType;

  @ApiProperty({ enum: ConsentStatus })
  status!: ConsentStatus;

  @ApiProperty()
  consent_version!: string;

  @ApiProperty()
  captured_by_id!: string;

  @ApiProperty()
  granted_at!: Date;

  @ApiPropertyOptional({ nullable: true })
  withdrawn_at!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  withdrawn_by_id!: string | null;

  @ApiPropertyOptional({ nullable: true })
  note!: string | null;

  @ApiProperty()
  created_at!: Date;
}
