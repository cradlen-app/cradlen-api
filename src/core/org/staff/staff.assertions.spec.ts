import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DayOfWeek } from '@prisma/client';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { BranchScheduleDto } from './dto/staff.dto';
import {
  assertRolesExist,
  assertScheduleBranches,
  assertShiftTimes,
  resolveJobFunctionAndSpecialty,
  resolveSubspecialties,
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

describe('resolveJobFunctionAndSpecialty', () => {
  function prisma(opts: {
    jobFunction?: unknown;
    specialty?: unknown;
  }): PrismaService {
    return {
      db: {
        jobFunction: {
          findFirst: jest.fn().mockResolvedValue(opts.jobFunction ?? null),
        },
        specialty: {
          findFirst: jest.fn().mockResolvedValue(opts.specialty ?? null),
        },
      },
    } as unknown as PrismaService;
  }

  it('returns nulls when no codes are supplied', async () => {
    const result = await resolveJobFunctionAndSpecialty(prisma({}));
    expect(result).toEqual({ jobFunction: null, specialty: null });
  });

  it('throws when the specialty code is unknown', async () => {
    await expect(
      resolveJobFunctionAndSpecialty(prisma({}), undefined, 'BOGUS'),
    ).rejects.toThrow(/Unknown specialty_code/);
  });

  it('resolves a known specialty', async () => {
    const specialty = { id: 'spec-1', code: 'OBGYN' };
    const result = await resolveJobFunctionAndSpecialty(
      prisma({ specialty }),
      undefined,
      'OBGYN',
    );
    expect(result.specialty).toBe(specialty);
  });
});

describe('resolveSubspecialties', () => {
  function prismaWithSubs(rows: { code: string; specialty_id: string }[]) {
    return {
      db: {
        subspecialty: { findMany: jest.fn().mockResolvedValue(rows) },
      },
    } as unknown as PrismaService;
  }

  it('returns [] without querying when no codes are supplied', async () => {
    const db = prismaWithSubs([]);
    await expect(resolveSubspecialties(db, undefined, 'spec-1')).resolves.toEqual(
      [],
    );
    expect(
      (db as unknown as { db: { subspecialty: { findMany: jest.Mock } } }).db
        .subspecialty.findMany,
    ).not.toHaveBeenCalled();
  });

  it('throws when subspecialties are given without a specialty', async () => {
    await expect(
      resolveSubspecialties(prismaWithSubs([]), ['REI'], null),
    ).rejects.toThrow(/require a specialty/);
  });

  it('throws when a subspecialty code is unknown', async () => {
    await expect(
      resolveSubspecialties(prismaWithSubs([]), ['REI'], 'spec-1'),
    ).rejects.toThrow(/Unknown subspecialty_codes/);
  });

  it('throws when a subspecialty belongs to a different specialty (parent invariant)', async () => {
    const db = prismaWithSubs([{ code: 'REI', specialty_id: 'other-spec' }]);
    await expect(
      resolveSubspecialties(db, ['REI'], 'spec-1'),
    ).rejects.toThrow(/do not belong to the selected specialty/);
  });

  it('resolves subspecialties that belong to the specialty', async () => {
    const rows = [{ code: 'REI', specialty_id: 'spec-1' }];
    await expect(
      resolveSubspecialties(prismaWithSubs(rows), ['REI'], 'spec-1'),
    ).resolves.toEqual(rows);
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
