import { NoteVisibility } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateNoteDto {
  @IsString() @MinLength(1) @MaxLength(80) section_code!: string;
  @IsString() @MinLength(1) @MaxLength(5000) content!: string;
  @IsEnum(NoteVisibility) @IsOptional() visibility?: NoteVisibility;
}

export class UpdateNoteDto {
  @IsString() @IsOptional() @MinLength(1) @MaxLength(5000) content?: string;
  @IsEnum(NoteVisibility) @IsOptional() visibility?: NoteVisibility;
}

export class ListNotesQueryDto {
  @IsString() @IsOptional() @MaxLength(80) section_code?: string;
}

export class NoteDto {
  id!: string;
  patient_id!: string;
  organization_id!: string;
  author_id!: string;
  section_code!: string;
  content!: string;
  visibility!: string;
  created_at!: Date;
  updated_at!: Date;
}

/**
 * Returned to callers from foreign orgs in place of redacted notes.
 * Tells the doctor "context exists at clinic X" without leaking content.
 */
export class RedactedNoteCountDto {
  organization_id!: string;
  organization_name!: string;
  section_code!: string;
  count!: number;
}

export class NotesListDto {
  visible!: NoteDto[];
  redacted_by_org!: RedactedNoteCountDto[];
}
