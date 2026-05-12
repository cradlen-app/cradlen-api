import { Prisma } from '@prisma/client';
import type { BranchScheduleDto } from './dto/staff.dto.js';

/**
 * Bulk-writes working schedules, days, and shifts for a profile inside an
 * existing transaction. Replaces the previous per-day loop that issued N+M
 * sequential queries and hit Prisma's 5 s interactive-transaction timeout.
 *
 * Query budget: 1 findMany + 0-1 createManyAndReturn (schedules) +
 *               1 deleteMany + 1 createManyAndReturn (days) + 0-1 createMany (shifts)
 */
export async function persistSchedules(
  tx: Prisma.TransactionClient,
  profileId: string,
  schedule: BranchScheduleDto[],
): Promise<void> {
  const branchIds = schedule.map((s) => s.branch_id);

  const existing = await tx.workingSchedule.findMany({
    where: { profile_id: profileId, branch_id: { in: branchIds } },
  });

  const existingBranchIds = new Set(existing.map((ws) => ws.branch_id));
  const missingData = schedule
    .filter((s) => !existingBranchIds.has(s.branch_id))
    .map((s) => ({ profile_id: profileId, branch_id: s.branch_id }));

  const created =
    missingData.length > 0
      ? await tx.workingSchedule.createManyAndReturn({ data: missingData })
      : [];

  const allSchedules = [...existing, ...created];
  const scheduleByBranch = new Map(
    allSchedules.map((ws) => [ws.branch_id, ws]),
  );
  const scheduleIds = allSchedules.map((ws) => ws.id);

  await tx.workingDay.deleteMany({
    where: { schedule_id: { in: scheduleIds } },
  });

  const allDayData = schedule.flatMap((bs) => {
    const ws = scheduleByBranch.get(bs.branch_id)!;
    return bs.days.map((day) => ({
      schedule_id: ws.id,
      day_of_week: day.day_of_week,
    }));
  });

  if (allDayData.length === 0) return;

  const createdDays = await tx.workingDay.createManyAndReturn({
    data: allDayData,
  });

  const shiftsByKey = new Map<
    string,
    BranchScheduleDto['days'][number]['shifts']
  >();
  for (const bs of schedule) {
    const ws = scheduleByBranch.get(bs.branch_id)!;
    for (const day of bs.days) {
      shiftsByKey.set(`${ws.id}:${day.day_of_week}`, day.shifts);
    }
  }

  const allShifts = createdDays.flatMap((cd) => {
    const shifts = shiftsByKey.get(`${cd.schedule_id}:${cd.day_of_week}`) ?? [];
    return shifts.map((s) => ({
      day_id: cd.id,
      start_time: s.start_time,
      end_time: s.end_time,
    }));
  });

  if (allShifts.length > 0) {
    await tx.workingShift.createMany({ data: allShifts });
  }
}
