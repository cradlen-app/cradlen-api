import { Test, TestingModule } from '@nestjs/testing';
import { CalendarConflictsService } from './calendar-conflicts.service';
import { PrismaService } from '../../database/prisma.service';

describe('CalendarConflictsService', () => {
  let service: CalendarConflictsService;
  let db: {
    calendarEvent: { findMany: jest.Mock };
    visit: { findMany: jest.Mock };
    workingSchedule: { findMany: jest.Mock };
  };

  const profileA = '11111111-1111-1111-1111-111111111111';
  const profileB = '22222222-2222-2222-2222-222222222222';
  const branchId = '33333333-3333-3333-3333-333333333333';
  const orgId = '44444444-4444-4444-4444-444444444444';

  // Use a Tuesday at 14:00 local time so the test does not depend on TZ
  // beyond what `getDay()` reports for the test machine.
  const startsAt = new Date('2026-05-12T14:00:00');
  const endsAt = new Date('2026-05-12T15:00:00');

  beforeEach(async () => {
    db = {
      calendarEvent: { findMany: jest.fn().mockResolvedValue([]) },
      visit: { findMany: jest.fn().mockResolvedValue([]) },
      workingSchedule: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarConflictsService,
        { provide: PrismaService, useValue: { db } },
      ],
    }).compile();
    service = module.get<CalendarConflictsService>(CalendarConflictsService);
  });

  it('returns empty array when no participants are provided', async () => {
    const result = await service.findConflicts({
      organizationId: orgId,
      startsAt,
      endsAt,
      participantProfileIds: [],
    });
    expect(result).toEqual([]);
    expect(db.calendarEvent.findMany).not.toHaveBeenCalled();
  });

  it('flags overlapping calendar events for involved profiles', async () => {
    db.calendarEvent.findMany.mockResolvedValue([
      {
        id: 'event-1',
        title: 'Cholecystectomy',
        type: 'SURGERY',
        starts_at: new Date('2026-05-12T14:30:00'),
        ends_at: new Date('2026-05-12T16:00:00'),
        created_by_id: profileA,
        participants: [{ profile_id: profileB }],
      },
    ]);

    const result = await service.findConflicts({
      organizationId: orgId,
      startsAt,
      endsAt,
      participantProfileIds: [profileA, profileB],
    });

    expect(result).toHaveLength(2);
    expect(result.every((c) => c.kind === 'EVENT')).toBe(true);
    expect(result.map((c) => c.profile_id).sort()).toEqual(
      [profileA, profileB].sort(),
    );
    expect(result[0].summary).toContain('SURGERY');
  });

  it('flags overlapping visits at point-in-time', async () => {
    db.visit.findMany.mockResolvedValue([
      {
        id: 'visit-1',
        scheduled_at: new Date('2026-05-12T14:30:00'),
        assigned_doctor_id: profileA,
        visit_type: 'FOLLOW_UP',
      },
    ]);

    const result = await service.findConflicts({
      organizationId: orgId,
      startsAt,
      endsAt,
      participantProfileIds: [profileA],
    });

    expect(result).toEqual([
      expect.objectContaining({
        profile_id: profileA,
        kind: 'VISIT',
        ref_id: 'visit-1',
      }),
    ]);
  });

  it('flags OUT_OF_SCHEDULE when event falls outside any working shift', async () => {
    db.workingSchedule.findMany.mockResolvedValue([
      {
        profile_id: profileA,
        days: [
          {
            day_of_week: 'TUE',
            shifts: [{ start_time: '09:00', end_time: '13:00' }],
          },
        ],
      },
    ]);

    const result = await service.findConflicts({
      organizationId: orgId,
      startsAt,
      endsAt,
      participantProfileIds: [profileA],
      branchId,
      type: 'SURGERY',
    });

    expect(result).toEqual([
      expect.objectContaining({
        profile_id: profileA,
        kind: 'OUT_OF_SCHEDULE',
      }),
    ]);
  });

  it('does not flag OUT_OF_SCHEDULE when event falls fully inside a shift', async () => {
    db.workingSchedule.findMany.mockResolvedValue([
      {
        profile_id: profileA,
        days: [
          {
            day_of_week: 'TUE',
            shifts: [{ start_time: '09:00', end_time: '17:00' }],
          },
        ],
      },
    ]);

    const result = await service.findConflicts({
      organizationId: orgId,
      startsAt,
      endsAt,
      participantProfileIds: [profileA],
      branchId,
      type: 'SURGERY',
    });

    expect(result).toEqual([]);
  });

  it('skips OUT_OF_SCHEDULE check for LEAVE events', async () => {
    const result = await service.findConflicts({
      organizationId: orgId,
      startsAt,
      endsAt,
      participantProfileIds: [profileA],
      branchId,
      type: 'LEAVE',
    });

    expect(db.workingSchedule.findMany).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('skips OUT_OF_SCHEDULE check when branchId is missing', async () => {
    await service.findConflicts({
      organizationId: orgId,
      startsAt,
      endsAt,
      participantProfileIds: [profileA],
      type: 'MEETING',
    });
    expect(db.workingSchedule.findMany).not.toHaveBeenCalled();
  });

  it('passes excludeEventId to the calendar event lookup', async () => {
    await service.findConflicts({
      organizationId: orgId,
      startsAt,
      endsAt,
      participantProfileIds: [profileA],
      excludeEventId: 'event-to-exclude',
    });

    expect(db.calendarEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: 'event-to-exclude' },
        }),
      }),
    );
  });
});
