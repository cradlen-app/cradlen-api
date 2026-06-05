/**
 * Clinical domain events catalog.
 *
 * Single source of truth for event names + typed payloads emitted by the
 * clinical layer (core/clinical and specialty modules). Consumers subscribe
 * via `@OnEvent('<name>')` from `@nestjs/event-emitter`.
 *
 * Naming convention: `<entity>.<verb-past-tense>`, lowercase, dot-separated.
 * Specialty modules MAY introduce events under their own namespace (e.g.
 * `pediatric.immunization.administered`) but never under a core entity.
 */

export const CLINICAL_EVENTS = {
  patient: {
    created: 'patient.created',
    historyUpdated: 'patient.history.updated',
    guardianLinked: 'patient.guardian.linked',
  },
  journey: {
    started: 'journey.started',
    completed: 'journey.completed',
    /**
     * Emitted when a cancellation/no-show leaves a journey with zero
     * ever-checked-in visits AND zero remaining live visits — the cascade
     * soft-deletes the journey + its episodes + visits + encounter/vitals.
     * Consumers should clear any cached lookups of the org's patient list.
     */
    cancelledEmpty: 'journey.cancelled_empty',
    /**
     * Emitted by a journey clinical-surface PATCH
     * (PATCH /v1/visits/:visitId/journeys/:journeyId/clinical) — the active
     * journey's profile + per-visit surveillance. One event per save. The
     * concrete writer is the (deferred) pregnancy clinical vertical; the name
     * is declared here so consumers/specialty modules reference it, not an
     * ad-hoc string.
     */
    clinicalUpdated: 'journey.clinical.updated',
  },
  episode: {
    opened: 'episode.opened',
    closed: 'episode.closed',
  },
  visit: {
    scheduled: 'visit.scheduled',
    checkedIn: 'visit.checked_in',
    completed: 'visit.completed',
  },
  encounter: {
    finalized: 'encounter.finalized',
    amended: 'encounter.amended',
    /**
     * Emitted by the unified Examination tab PATCH
     * (PATCH /v1/visits/:id/examination). One event per save, regardless
     * of how many underlying aggregates (encounter / vitals / obgyn-encounter
     * / investigations / prescription) were touched.
     */
    examinationUpdated: 'visit.examination.updated',
  },
  investigation: {
    ordered: 'investigation.ordered',
    resulted: 'investigation.resulted',
    /**
     * Emitted once when a patient uploads the first result file for an
     * investigation (the ORDERED → RESULTED transition). Drives the "patient
     * uploaded a result" notification to the ordering doctor.
     */
    resultUploaded: 'investigation.result_uploaded',
  },
  prescription: {
    issued: 'prescription.issued',
    amended: 'prescription.amended',
  },
  pregnancy: {
    booked: 'pregnancy.booked',
    riskLevelChanged: 'pregnancy.risk_level.changed',
    closed: 'pregnancy.closed',
  },
} as const;

// ---------- Payload contracts (subscribers should rely on these) ----------

export interface PatientHistoryUpdatedEvent {
  patient_id: string;
  specialty: string;
  /** Section codes that changed in this PATCH. May be one or many. */
  section_codes: string[];
  updated_by_id: string;
  version: number;
}

export interface EncounterAmendedEvent {
  visit_id: string;
  patient_id: string;
  target: string;
  section: string | null;
  amended_by_id: string;
  reason: string;
  version_from: number;
  version_to: number;
}

export interface PregnancyBookedEvent {
  journey_id: string;
  patient_id: string;
  lmp: Date | null;
  risk_level: string | null;
}

export interface PregnancyRiskLevelChangedEvent {
  journey_id: string;
  previous_risk_level: string | null;
  new_risk_level: string | null;
  updated_by_id: string;
}

export interface VisitPregnancyRecordUpdatedEvent {
  visit_id: string;
  section: string;
  updated_by_id: string;
  version: number;
}

/**
 * Payload for `journey.clinical.updated`. Emitted when a care path's journey
 * clinical surface (journey profile + per-visit surveillance) is saved within a
 * visit. The concrete writer is the deferred pregnancy clinical vertical.
 */
export interface JourneyClinicalUpdatedEvent {
  journey_id: string;
  visit_id: string;
  care_path_code: string;
  /** Surface scopes touched in this save: 'journey' | 'episode' | 'visit'. */
  scopes: string[];
  updated_by_id: string;
  version: number;
}

export interface VisitExaminationUpdatedEvent {
  visit_id: string;
  /** Aggregates touched in this save. Subset of:
   * 'encounter' | 'vitals' | 'obgyn_encounter' | 'investigations' |
   * 'prescription' | 'follow_up_date'.
   */
  aggregates: string[];
  updated_by_id: string;
  examination_version: number;
}

/**
 * Payload for `investigation.result_uploaded`. Emitted when a patient uploads
 * the first result file for an investigation. `ordered_by_id` is the ordering
 * doctor's profile — the notification recipient.
 */
export interface InvestigationResultUploadedEvent {
  investigation_id: string;
  visit_id: string;
  ordered_by_id: string;
  organization_id: string;
  branch_id: string | null;
  patient_id: string;
  patient_name: string;
  test_name: string;
}
