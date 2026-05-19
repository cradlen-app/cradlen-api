import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpsertFieldFlagDto {
  @IsString() @MinLength(1) @MaxLength(100) section_code!: string;
  @IsString() @MinLength(1) @MaxLength(100) field_code!: string;
  @IsOptional() @IsString() @MaxLength(5000) note?: string;
}

export class UpdateFieldFlagNoteDto {
  @IsOptional() @IsString() @MaxLength(5000) note?: string;
}

export class FieldFlagDto {
  id!: string;
  patient_id!: string;
  organization_id!: string;
  author_id!: string;
  section_code!: string;
  field_code!: string;
  note!: string | null;
  created_at!: Date;
  updated_at!: Date;
}
