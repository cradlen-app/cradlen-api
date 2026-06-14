import { MedicalRepVisitStatus, VisitStatus } from '@prisma/client';

/** Statuses from which no further transition is allowed. */
export const TERMINAL_STATES: VisitStatus[] = [
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
];

/**
 * Non-terminal (live-queue) visit statuses — a visit that still counts as part of
 * today's operational load. The complement of {@link TERMINAL_STATES}. Used by the
 * today-stats endpoint so its counts reconcile with the waiting-list and
 * in-progress views.
 */
export const ACTIVE_VISIT_STATUSES: VisitStatus[] = [
  'SCHEDULED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'IN_CONSULTATION',
];

/** Non-terminal medical-rep visit statuses (the rep lifecycle has no IN_CONSULTATION). */
export const ACTIVE_REP_VISIT_STATUSES: MedicalRepVisitStatus[] = [
  'SCHEDULED',
  'CHECKED_IN',
  'IN_PROGRESS',
];

/** Allowed next-states per current status (the visit lifecycle state machine). */
export const VALID_TRANSITIONS: Record<VisitStatus, VisitStatus[]> = {
  SCHEDULED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['IN_CONSULTATION', 'CANCELLED', 'NO_SHOW'],
  IN_CONSULTATION: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

/** Visit column stamped with `now` when a status is entered. */
export const STATUS_TIMESTAMPS: Partial<Record<VisitStatus, string>> = {
  CHECKED_IN: 'checked_in_at',
  IN_PROGRESS: 'started_at',
  IN_CONSULTATION: 'consultation_started_at',
  COMPLETED: 'completed_at',
};
