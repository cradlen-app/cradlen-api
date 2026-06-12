import { VisitStatus } from '@prisma/client';

/** Statuses from which no further transition is allowed. */
export const TERMINAL_STATES: VisitStatus[] = [
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
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
