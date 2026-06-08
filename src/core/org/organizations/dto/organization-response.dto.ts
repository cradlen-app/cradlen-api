import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrganizationStatus } from '@prisma/client';

export class SpecialtySummaryDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id!: string;

  @ApiProperty({ example: 'OBGYN' })
  code!: string;

  @ApiProperty({ example: 'Obstetrics & Gynecology' })
  name!: string;
}

export class OrganizationResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id!: string;

  @ApiProperty({ example: 'Jasmin Clinic' })
  name!: string;

  @ApiProperty({ enum: OrganizationStatus })
  status!: OrganizationStatus;

  @ApiProperty({ type: [SpecialtySummaryDto] })
  specialties!: SpecialtySummaryDto[];

  /** Short-lived presigned GET URL for the logo, or null when none. */
  @ApiPropertyOptional({ nullable: true })
  logo_image_url!: string | null;

  @ApiProperty()
  created_at!: Date;

  @ApiProperty()
  updated_at!: Date;
}

class CreatedBranchDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  city!: string | null;

  @ApiProperty({ nullable: true })
  governorate!: string | null;

  @ApiProperty()
  is_main!: boolean;
}

class CreatedOrganizationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: [SpecialtySummaryDto] })
  specialties!: SpecialtySummaryDto[];

  @ApiProperty({ enum: OrganizationStatus })
  status!: OrganizationStatus;
}

class CreatedProfileDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: [String], example: ['OWNER'] })
  roles!: string[];

  @ApiProperty({ type: CreatedBranchDto })
  branch!: CreatedBranchDto;
}

export class CreateOrganizationResultDto {
  @ApiProperty({ type: CreatedOrganizationDto })
  organization!: CreatedOrganizationDto;

  @ApiProperty({ type: CreatedProfileDto })
  profile!: CreatedProfileDto;
}
