import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export const AMENDMENT_TARGETS = [
  'obgyn_encounter',
  'patient_obgyn_history',
] as const;

export type AmendmentTarget = (typeof AMENDMENT_TARGETS)[number];

export class CreateAmendmentDto {
  @IsIn([...AMENDMENT_TARGETS])
  target!: AmendmentTarget;

  /**
   * Section key — required for table types that fan out by section (e.g.
   * `pelvic_findings`, `breast_findings`, `menstrual_findings` on
   * obgyn_encounter). Optional for monolithic tables.
   */
  @IsOptional() @IsString() section?: string;

  /** Field-level changes — same shape the corresponding PATCH would accept. */
  @IsObject() changes!: Record<string, unknown>;

  /** Mandatory free-text justification. Surfaced in the audit timeline. */
  @IsString() @IsNotEmpty() @MinLength(8) reason!: string;
}

export class AmendmentResultDto {
  target!: AmendmentTarget;
  section!: string | null;
  visit_id!: string | null;
  journey_id!: string | null;
  episode_id!: string | null;
  patient_id!: string | null;
  version_from!: number;
  version_to!: number;
  amended_by_id!: string;
  reason!: string;
  amended_at!: Date;
}
