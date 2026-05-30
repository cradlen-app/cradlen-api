import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The flat `branch_*` fields used when bootstrapping an organization's main
 * branch. Shared base for both `CreateOrganizationDto` and `SignupCompleteDto`
 * so the field set + validators live in one place. Kept flat (not nested) to
 * preserve the existing request contract.
 */
export class BranchInputFieldsDto {
  @ApiProperty({ example: 'Main Branch' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  branch_name!: string;

  @ApiProperty({ example: '123 Main St' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  branch_address!: string;

  @ApiProperty({ example: 'Cairo' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  branch_city!: string;

  @ApiProperty({ example: 'Giza' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  branch_governorate!: string;

  @ApiPropertyOptional({ example: 'Egypt' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  branch_country?: string;
}
