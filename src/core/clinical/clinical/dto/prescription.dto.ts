import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class UpsertPrescriptionDto {
  @IsString() @IsOptional() @MaxLength(5000) notes?: string;
}

export class CreatePrescriptionItemDto {
  @IsUUID() @IsOptional() medication_id?: string;
  @IsString() @IsOptional() @MaxLength(200) custom_drug_name?: string;
  @IsString() @MaxLength(64) dose!: string;
  @IsString() @IsOptional() @MaxLength(32) route?: string;
  @IsString() @MaxLength(64) frequency!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) duration_days?: number;
  @IsString() @IsOptional() @MaxLength(500) instructions?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) order?: number;
}

export class UpdatePrescriptionItemDto {
  @IsUUID() @IsOptional() medication_id?: string;
  @IsString() @IsOptional() @MaxLength(200) custom_drug_name?: string;
  @IsString() @IsOptional() @MaxLength(64) dose?: string;
  @IsString() @IsOptional() @MaxLength(32) route?: string;
  @IsString() @IsOptional() @MaxLength(64) frequency?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) duration_days?: number;
  @IsString() @IsOptional() @MaxLength(500) instructions?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) order?: number;
}

export class PrescriptionItemDto {
  id!: string;
  prescription_id!: string;
  medication_id!: string | null;
  custom_drug_name!: string | null;
  dose!: string;
  route!: string | null;
  frequency!: string;
  duration_days!: number | null;
  instructions!: string | null;
  order!: number;
  created_at!: Date;
  updated_at!: Date;
}

export class PrescriptionDto {
  id!: string;
  visit_id!: string;
  prescribed_by_id!: string;
  prescribed_at!: Date;
  notes!: string | null;
  items!: PrescriptionItemDto[];
  created_at!: Date;
  updated_at!: Date;
}
