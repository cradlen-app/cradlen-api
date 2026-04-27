import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrganizationStatus } from '@prisma/client';

export class OwnerUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() first_name!: string;
  @ApiProperty() last_name!: string;
  @ApiProperty() email!: string;
  @ApiPropertyOptional() phone_number?: string;
}

export class OwnerProfileDto {
  @ApiProperty() is_clinical!: boolean;
  @ApiPropertyOptional() speciality?: string;
}

export class OwnerStaffDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional() job_title?: string;
  @ApiPropertyOptional() specialty?: string;
  @ApiProperty() role!: { id: string; name: string };
}

export class OwnerOrganizationDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: [String] }) specialities!: string[];
  @ApiProperty({ enum: OrganizationStatus }) status!: OrganizationStatus;
}

export class OwnerResponseDto {
  @ApiProperty({ type: OwnerUserDto }) user!: OwnerUserDto;
  @ApiProperty({ type: OwnerProfileDto }) profile!: OwnerProfileDto;
  @ApiProperty({ type: OwnerStaffDto }) staff!: OwnerStaffDto;
  @ApiProperty({ type: OwnerOrganizationDto })
  organization!: OwnerOrganizationDto;
}
