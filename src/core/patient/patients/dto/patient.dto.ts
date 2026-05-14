import {
  JourneyStatus,
  JourneyTemplateType,
  MaritalStatus,
} from '@prisma/client';

export class PatientDto {
  id!: string;
  national_id!: string;
  full_name!: string;
  husband_name!: string | null;
  date_of_birth!: Date;
  phone_number!: string;
  address!: string;
  marital_status!: MaritalStatus;
  created_at!: Date;
  /** Flattened SPOUSE guardian link (when the patient has one). */
  spouse_guardian_id?: string;
  spouse_full_name?: string;
  spouse_national_id?: string;
  spouse_phone_number?: string;
}

export class EpisodeSummaryDto {
  id!: string;
  name!: string;
  order!: number;
}

export class PatientLookupDto extends PatientDto {
  active_episodes!: EpisodeSummaryDto[];
  /**
   * Code of the patient's most recently started ACTIVE journey's care path,
   * or undefined when the patient has no active care path. Used by the
   * book-visit form to preselect the care-path picker.
   */
  active_care_path_code?: string;
}

export class ActiveJourneyDto {
  id!: string;
  type!: JourneyTemplateType;
  status!: JourneyStatus;
}

export class BranchPatientDto extends PatientDto {
  journey!: ActiveJourneyDto | null;
  last_visit_date!: Date | null;
}
