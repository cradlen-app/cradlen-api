import { Type } from 'class-transformer';
import { InvestigationResultSource, InvestigationStatus } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateInvestigationItemDto {
  @IsUUID() @IsOptional() lab_test_id?: string;
  @IsString() @IsOptional() @MaxLength(200) custom_test_name?: string;
  @IsString() @IsOptional() @MaxLength(2000) notes?: string;
  @IsString() @IsOptional() @MaxLength(200) lab_facility?: string;
}

export class CreateInvestigationsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateInvestigationItemDto)
  items!: CreateInvestigationItemDto[];
}

export class UpdateInvestigationDto {
  @IsEnum(InvestigationStatus) @IsOptional() status?: InvestigationStatus;
  @IsString() @IsOptional() @MaxLength(5000) result_text?: string;
  @IsUrl() @IsOptional() @MaxLength(2048) result_attachment_url?: string;
  @IsEnum(InvestigationResultSource)
  @IsOptional()
  result_source?: InvestigationResultSource;
  @IsString() @IsOptional() @MaxLength(2000) notes?: string;
  @IsString() @IsOptional() @MaxLength(200) lab_facility?: string;
  @IsString() @IsOptional() @MaxLength(200) external_ref?: string;
  @IsString() @IsOptional() @MaxLength(200) external_provider?: string;
}

export class ListInvestigationsQueryDto {
  @IsEnum(InvestigationStatus) @IsOptional() status?: InvestigationStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number = 50;
}

export class InvestigationDto {
  id!: string;
  visit_id!: string;
  lab_test_id!: string | null;
  custom_test_name!: string | null;
  notes!: string | null;
  lab_facility!: string | null;
  status!: string;
  result_text!: string | null;
  result_attachment_url!: string | null;
  result_source!: string;
  resulted_at!: Date | null;
  resulted_by_id!: string | null;
  reviewed_at!: Date | null;
  reviewed_by_id!: string | null;
  external_ref!: string | null;
  external_provider!: string | null;
  ordered_by_id!: string;
  ordered_at!: Date;
  created_at!: Date;
  updated_at!: Date;
}
