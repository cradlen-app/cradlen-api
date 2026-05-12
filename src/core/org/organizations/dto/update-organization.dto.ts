import { ApiPropertyOptional } from '@nestjs/swagger';
import { OrganizationStatus } from '@prisma/client';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateOrganizationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ enum: OrganizationStatus })
  @IsOptional()
  @IsEnum(OrganizationStatus)
  status?: OrganizationStatus;

  @ApiPropertyOptional({
    type: [String],
    description:
      "Specialty codes (or names) — resolved against the Specialty table. When provided, replaces the organization's current specialty set.",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  specialties?: string[];
}
