/**
 * Calendar domain events catalog.
 *
 * Single source of truth for event names emitted by the calendar module.
 * Consumers subscribe via `@OnEvent('<name>')` from `@nestjs/event-emitter`.
 */

export const CALENDAR_EVENTS = {
  event: {
    created: 'calendar.event.created',
    updated: 'calendar.event.updated',
    deleted: 'calendar.event.deleted',
  },
} as const;

export interface CalendarEventChangedPayload {
  id: string;
  profile_id: string;
  organization_id: string;
  event_type: string;
  visibility: string;
  branch_id: string | null;
  start_at: Date;
  end_at: Date;
}
