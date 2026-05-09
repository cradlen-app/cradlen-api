import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateOrganizationDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  organization_name!: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Specialty codes (or names) — resolved against the Specialty table.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  specialties?: string[];

  @ApiProperty()
  @IsString()
  @MinLength(1)
  branch_name!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  branch_address!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  branch_city!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  branch_governorate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branch_country?: string;
}
