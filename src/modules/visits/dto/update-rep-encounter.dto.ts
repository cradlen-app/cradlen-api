import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class RepEncounterDrugDto {
  @IsUUID() medication_id!: string;
  @IsOptional() @IsInt() @Min(0) samples_count?: number;
  @IsOptional() @IsInt() @Min(0) materials_count?: number;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class UpdateRepEncounterDto {
  @IsOptional() @IsDateString() follow_up_date?: string;
  @IsOptional() @IsString() @MaxLength(1000) signature_url?: string;
  @IsOptional() @IsString() @MaxLength(200) overall_outcome?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => RepEncounterDrugDto)
  drugs_detailed?: RepEncounterDrugDto[];
}
