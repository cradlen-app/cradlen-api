import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';
import { BranchInputFieldsDto } from '@core/org/branches/dto/branch-input-fields.dto.js';

export class CreateOrganizationDto extends BranchInputFieldsDto {
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
}
