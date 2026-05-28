import { CalendarEventType, CalendarVisibility } from '@prisma/client';

export const DEFAULT_VISIBILITY: Record<CalendarEventType, CalendarVisibility> =
  {
    DAY_OFF: CalendarVisibility.ORGANIZATION,
    PROCEDURE: CalendarVisibility.ORGANIZATION,
    MEETING: CalendarVisibility.PRIVATE,
    GENERIC: CalendarVisibility.PRIVATE,
  };
