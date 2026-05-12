import { IsObject, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

// Body-system finding payloads are free-form JSON during the early phase.
// Each section's shape — including the per-section `note: string` — is
// validated app-side by the consuming UI layer until the JSON-promotion rule
// fires (see plan: JSON Promotion Rule).

class FindingsDto {
  @IsOptional() @IsObject() value?: Record<string, unknown>;
}

export class GeneralFindingsDto extends FindingsDto {}
export class CardiovascularFindingsDto extends FindingsDto {}
export class RespiratoryFindingsDto extends FindingsDto {}
export class MenstrualFindingsDto extends FindingsDto {}
export class AbdominalFindingsDto extends FindingsDto {}
export class PelvicFindingsDto extends FindingsDto {}
export class BreastFindingsDto extends FindingsDto {}
export class ExtremitiesFindingsDto extends FindingsDto {}
export class NeurologicalFindingsDto extends FindingsDto {}
export class SkinFindingsDto extends FindingsDto {}

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
