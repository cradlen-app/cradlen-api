import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * `name` is the only non-nullable column on Medication (besides `code`, which
 * is immutable). Every other patchable field is nullable in the DB — use
 * `@ValidateIf(x !== null)` so clients can explicitly clear them.
 */
export class UpdateMedicationDto {
  @IsString() @IsOptional() @MinLength(1) @MaxLength(200) name?: string;

  @ValidateIf((o: UpdateMedicationDto) => o.generic_name !== null)
  @IsString()
  @IsOptional()
  @MaxLength(200)
  generic_name?: string | null;

  @ValidateIf((o: UpdateMedicationDto) => o.form !== null)
  @IsString()
  @IsOptional()
  @MaxLength(64)
  form?: string | null;

  @ValidateIf((o: UpdateMedicationDto) => o.strength !== null)
  @IsString()
  @IsOptional()
  @MaxLength(64)
  strength?: string | null;

  @ValidateIf((o: UpdateMedicationDto) => o.category !== null)
  @IsString()
  @IsOptional()
  @MaxLength(100)
  category?: string | null;

  @ValidateIf((o: UpdateMedicationDto) => o.company !== null)
  @IsString()
  @IsOptional()
  @MaxLength(200)
  company?: string | null;

  @ValidateIf((o: UpdateMedicationDto) => o.notes !== null)
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string | null;

  @ValidateIf((o: UpdateMedicationDto) => o.default_dose_amount !== null)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(99999)
  default_dose_amount?: number | null;

  @ValidateIf((o: UpdateMedicationDto) => o.default_dose_unit !== null)
  @IsString()
  @IsOptional()
  @MaxLength(32)
  default_dose_unit?: string | null;

  @ValidateIf((o: UpdateMedicationDto) => o.default_dose_frequency !== null)
  @IsString()
  @IsOptional()
  @MaxLength(64)
  default_dose_frequency?: string | null;

  @ValidateIf((o: UpdateMedicationDto) => o.default_dose_route !== null)
  @IsString()
  @IsOptional()
  @MaxLength(64)
  default_dose_route?: string | null;
}
