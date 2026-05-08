import { Injectable } from '@nestjs/common';
import { CalendarEventType, DayOfWeek } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { CalendarEventConflictDto } from './dto/calendar-event.dto.js';

interface ConflictCheckInput {
  organizationId: string;
  startsAt: Date;
  endsAt: Date;
  participantProfileIds: string[];
  branchId?: string | null;
  type?: CalendarEventType;
  excludeEventId?: string;
}

const DAY_OF_WEEK_BY_INDEX: DayOfWeek[] = [
  'SUN',
  'MON',
  'TUE',
  'WED',
  'THU',
  'FRI',
  'SAT',
];

@Injectable()
export class CalendarConflictsService {
  constructor(private readonly prismaService: PrismaService) {}

  async findConflicts(
    input: ConflictCheckInput,
  ): Promise<CalendarEventConflictDto[]> {
    const { participantProfileIds } = input;
    if (!participantProfileIds.length) return [];

    const [eventConflicts, visitConflicts, scheduleConflicts] =
      await Promise.all([
        this.findOverlappingEvents(input),
        this.findOverlappingVisits(input),
        this.findOutOfSchedule(input),
      ]);

    return [...eventConflicts, ...visitConflicts, ...scheduleConflicts];
  }

  private async findOverlappingEvents(
    input: ConflictCheckInput,
  ): Promise<CalendarEventConflictDto[]> {
    const events = await this.prismaService.db.calendarEvent.findMany({
      where: {
        is_deleted: false,
        status: 'SCHEDULED',
        organization_id: input.organizationId,
        ...(input.excludeEventId && { id: { not: input.excludeEventId } }),
        starts_at: { lt: input.endsAt },
        ends_at: { gt: input.startsAt },
        OR: [
          { created_by_id: { in: input.participantProfileIds } },
          {
            participants: {
              some: { profile_id: { in: input.participantProfileIds } },
            },
          },
        ],
      },
      select: {
        id: true,
        title: true,
        type: true,
        starts_at: true,
        ends_at: true,
        created_by_id: true,
        participants: {
          where: { profile_id: { in: input.participantProfileIds } },
          select: { profile_id: true },
        },
      },
    });

    const conflicts: CalendarEventConflictDto[] = [];
    for (const event of events) {
      const involved = new Set<string>(
        event.participants.map((p) => p.profile_id),
      );
      if (input.participantProfileIds.includes(event.created_by_id)) {
        involved.add(event.created_by_id);
      }
      for (const profileId of involved) {
        conflicts.push({
          profile_id: profileId,
          kind: 'EVENT',
          ref_id: event.id,
          starts_at: event.starts_at.toISOString(),
          ends_at: event.ends_at.toISOString(),
          summary: `${event.type}: ${event.title}`,
        });
      }
    }
    return conflicts;
  }

  private async findOverlappingVisits(
    input: ConflictCheckInput,
  ): Promise<CalendarEventConflictDto[]> {
    const visits = await this.prismaService.db.visit.findMany({
      where: {
        is_deleted: false,
        status: { in: ['SCHEDULED', 'CHECKED_IN', 'IN_PROGRESS'] },
        assigned_doctor_id: { in: input.participantProfileIds },
        scheduled_at: { gte: input.startsAt, lt: input.endsAt },
      },
      select: {
        id: true,
        scheduled_at: true,
        assigned_doctor_id: true,
        visit_type: true,
      },
    });

    return visits.map((visit) => ({
      profile_id: visit.assigned_doctor_id,
      kind: 'VISIT' as const,
      ref_id: visit.id,
      starts_at: visit.scheduled_at.toISOString(),
      summary: `Visit (${visit.visit_type})`,
    }));
  }

  private async findOutOfSchedule(
    input: ConflictCheckInput,
  ): Promise<CalendarEventConflictDto[]> {
    if (input.type === 'LEAVE' || !input.branchId) return [];

    const schedules = await this.prismaService.db.workingSchedule.findMany({
      where: {
        branch_id: input.branchId,
        profile_id: { in: input.participantProfileIds },
      },
      include: { days: { include: { shifts: true } } },
    });

    const conflicts: CalendarEventConflictDto[] = [];
    for (const profileId of input.participantProfileIds) {
      const schedule = schedules.find((s) => s.profile_id === profileId);
      if (!schedule) continue;

      const dayOfWeek = DAY_OF_WEEK_BY_INDEX[input.startsAt.getDay()];
      const day = schedule.days.find((d) => d.day_of_week === dayOfWeek);

      if (!day || !day.shifts.length) {
        conflicts.push({
          profile_id: profileId,
          kind: 'OUT_OF_SCHEDULE',
          summary: 'Outside working hours',
        });
        continue;
      }

      const eventStart = this.minutesOfDay(input.startsAt);
      const eventEnd = this.minutesOfDay(input.endsAt);
      const inAnyShift = day.shifts.some((shift) => {
        const shiftStart = this.parseTime(shift.start_time);
        const shiftEnd = this.parseTime(shift.end_time);
        return eventStart >= shiftStart && eventEnd <= shiftEnd;
      });
      if (!inAnyShift) {
        conflicts.push({
          profile_id: profileId,
          kind: 'OUT_OF_SCHEDULE',
          summary: 'Outside working hours',
        });
      }
    }
    return conflicts;
  }

  private minutesOfDay(date: Date): number {
    return date.getHours() * 60 + date.getMinutes();
  }

  private parseTime(value: string): number {
    const [h, m] = value.split(':').map((v) => parseInt(v, 10));
    return h * 60 + (m || 0);
  }
}
