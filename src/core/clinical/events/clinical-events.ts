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
  },
  investigation: {
    ordered: 'investigation.ordered',
    resulted: 'investigation.resulted',
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
