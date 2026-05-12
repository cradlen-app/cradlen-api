import { IsObject, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

// Body-system finding payloads are free-form JSON during the early phase.
// Each section's shape — including the per-section `note: string` — is
// validated app-side by the consuming UI until the JSON-promotion rule
// fires (see the design doc).

/**
 * Bulk PATCH body for the OB/GYN examination tab. Every section is optional;
 * unsent sections are left untouched. One PATCH = one row update = one
 * revision row.
 */
export class UpdateObgynEncounterDto {
  @IsOptional() @IsObject() general_findings?: Record<string, unknown>;
  @IsOptional() @IsObject() cardiovascular_findings?: Record<string, unknown>;
  @IsOptional() @IsObject() respiratory_findings?: Record<string, unknown>;
  @IsOptional() @IsObject() menstrual_findings?: Record<string, unknown>;
  @IsOptional() @IsObject() abdominal_findings?: Record<string, unknown>;
  @IsOptional() @IsObject() pelvic_findings?: Record<string, unknown>;
  @IsOptional() @IsObject() breast_findings?: Record<string, unknown>;
  @IsOptional() @IsObject() extremities_findings?: Record<string, unknown>;
  @IsOptional() @IsObject() neurological_findings?: Record<string, unknown>;
  @IsOptional() @IsObject() skin_findings?: Record<string, unknown>;
}

export class VisitObgynEncounterDto {
  id!: string;
  visit_id!: string;
  general_findings!: unknown;
  cardiovascular_findings!: unknown;
  respiratory_findings!: unknown;
  menstrual_findings!: unknown;
  abdominal_findings!: unknown;
  pelvic_findings!: unknown;
  breast_findings!: unknown;
  extremities_findings!: unknown;
  neurological_findings!: unknown;
  skin_findings!: unknown;
  version!: number;
  @Type(() => Date) updated_at!: Date;
}
