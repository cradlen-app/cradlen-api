import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DayOfWeek } from '@prisma/client';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { BranchScheduleDto } from './dto/staff.dto';
import {
  assertRolesExist,
  assertScheduleBranches,
  assertShiftTimes,
} from './staff.assertions';

const branchId = '11111111-1111-1111-1111-111111111111';

function buildSchedule(
  shifts: { start_time: string; end_time: string }[],
): BranchScheduleDto[] {
  return [
    {
      branch_id: branchId,
      days: [{ day_of_week: DayOfWeek.MONDAY, shifts }],
    },
  ];
}

describe('assertShiftTimes', () => {
  it('accepts a valid single shift', () => {
    expect(() =>
      assertShiftTimes(
        buildSchedule([{ start_time: '09:00', end_time: '17:00' }]),
      ),
    ).not.toThrow();
  });

  it('accepts non-overlapping back-to-back shifts', () => {
    expect(() =>
      assertShiftTimes(
        buildSchedule([
          { start_time: '09:00', end_time: '12:00' },
          { start_time: '13:00', end_time: '17:00' },
        ]),
      ),
    ).not.toThrow();
  });

  it('treats end == start as invalid (zero-length shift)', () => {
    expect(() =>
      assertShiftTimes(
        buildSchedule([{ start_time: '09:00', end_time: '09:00' }]),
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects end_time strictly before start_time', () => {
    expect(() =>
      assertShiftTimes(
        buildSchedule([{ start_time: '17:00', end_time: '09:00' }]),
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects overlapping shifts on the same day', () => {
    expect(() =>
      assertShiftTimes(
        buildSchedule([
          { start_time: '09:00', end_time: '12:00' },
          { start_time: '11:00', end_time: '13:00' },
        ]),
      ),
    ).toThrow(/Overlapping shifts/);
  });

  it('rejects nested shifts (one wholly contained in another)', () => {
    expect(() =>
      assertShiftTimes(
        buildSchedule([
          { start_time: '09:00', end_time: '17:00' },
          { start_time: '10:00', end_time: '11:00' },
        ]),
      ),
    ).toThrow(/Overlapping shifts/);
  });

  it('rejects unsorted overlapping shifts (sort-then-check)', () => {
    expect(() =>
      assertShiftTimes(
        buildSchedule([
          { start_time: '13:00', end_time: '15:00' },
          { start_time: '14:00', end_time: '16:00' },
        ]),
      ),
    ).toThrow(/Overlapping shifts/);
  });
});

describe('assertRolesExist', () => {
  function prismaWithRoleCount(count: number): PrismaService {
    return {
      db: { role: { count: jest.fn().mockResolvedValue(count) } },
    } as unknown as PrismaService;
  }

  it('resolves when every role id exists', async () => {
    const prisma = prismaWithRoleCount(2);
    await expect(
      assertRolesExist(prisma, ['role-a', 'role-b']),
    ).resolves.toBeUndefined();
  });

  it('throws NotFound when some role ids do not exist', async () => {
    const prisma = prismaWithRoleCount(1);
    await expect(
      assertRolesExist(prisma, ['role-a', 'missing']),
    ).rejects.toThrow(NotFoundException);
  });

  it('does NOT reject the OWNER role — privilege gating is enforced by the caller', async () => {
    // Promoting to OWNER is allowed; the OWNER-only gate lives in
    // AuthorizationService (assertNoPrivilegedRoleAssignment / assertOwnerOnly).
    const prisma = prismaWithRoleCount(1);
    await expect(
      assertRolesExist(prisma, ['owner-role-id']),
    ).resolves.toBeUndefined();
  });
});

describe('assertScheduleBranches', () => {
  const otherBranchId = '22222222-2222-2222-2222-222222222222';

  it('passes when every schedule branch_id is in the allowed set', () => {
    const schedule = buildSchedule([
      { start_time: '09:00', end_time: '17:00' },
    ]);
    expect(() =>
      assertScheduleBranches(schedule, [branchId, otherBranchId]),
    ).not.toThrow();
  });

  it('throws when a schedule branch_id is missing from the allowed set', () => {
    const schedule = buildSchedule([
      { start_time: '09:00', end_time: '17:00' },
    ]);
    expect(() => assertScheduleBranches(schedule, [otherBranchId])).toThrow(
      BadRequestException,
    );
  });
});
