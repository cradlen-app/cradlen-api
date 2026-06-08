import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JobFunction, Specialty } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { BranchScheduleDto } from './dto/staff.dto.js';
import { hhmmToMinutes } from './shift-time.helpers.js';

export interface ResolvedAccess {
  jobFunctions: JobFunction[];
  specialties: Specialty[];
}

export async function assertBranchesInOrganization(
  prisma: PrismaService,
  organizationId: string,
  branchIds: string[],
): Promise<void> {
  const count = await prisma.db.branch.count({
    where: {
      id: { in: branchIds },
      organization_id: organizationId,
      is_deleted: false,
    },
  });
  if (count !== branchIds.length) {
    throw new NotFoundException('One or more branches were not found');
  }
}

export async function assertRolesExist(
  prisma: PrismaService,
  roleIds: string[],
): Promise<void> {
  const count = await prisma.db.role.count({
    where: { id: { in: roleIds } },
  });
  if (count !== roleIds.length) {
    throw new NotFoundException('One or more roles were not found');
  }
}

export function assertScheduleBranches(
  schedule: BranchScheduleDto[],
  allowedBranchIds: string[],
): void {
  const allowed = new Set(allowedBranchIds);
  const invalidIds = schedule
    .map((s) => s.branch_id)
    .filter((id) => !allowed.has(id));
  if (invalidIds.length) {
    throw new BadRequestException(
      `Schedule branch_ids not in branch_ids: ${invalidIds.join(', ')}`,
    );
  }
}

/**
 * Validates every shift in `schedule`:
 *  - end_time strictly after start_time (compared as minutes-from-midnight)
 *  - shifts on the same branch+day do not overlap
 */
export function assertShiftTimes(schedule: BranchScheduleDto[]): void {
  for (const branch of schedule) {
    for (const day of branch.days) {
      const shifts = day.shifts.map((s) => ({
        start: hhmmToMinutes(s.start_time),
        end: hhmmToMinutes(s.end_time),
        raw: s,
      }));
      for (const s of shifts) {
        if (s.end <= s.start) {
          throw new BadRequestException(
            `Shift end_time must be after start_time (${s.raw.start_time} – ${s.raw.end_time})`,
          );
        }
      }
      const ordered = [...shifts].sort((a, b) => a.start - b.start);
      for (let i = 1; i < ordered.length; i++) {
        if (ordered[i].start < ordered[i - 1].end) {
          throw new BadRequestException(
            `Overlapping shifts on ${day.day_of_week} for branch ${branch.branch_id}: ` +
              `${ordered[i - 1].raw.start_time}–${ordered[i - 1].raw.end_time} and ` +
              `${ordered[i].raw.start_time}–${ordered[i].raw.end_time}`,
          );
        }
      }
    }
  }
}

export async function resolveJobFunctionsAndSpecialties(
  prisma: PrismaService,
  jobFunctionCodes?: string[],
  specialtyCodes?: string[],
): Promise<ResolvedAccess> {
  const [jobFunctions, specialties] = await Promise.all([
    jobFunctionCodes && jobFunctionCodes.length
      ? prisma.db.jobFunction.findMany({
          where: { code: { in: jobFunctionCodes } },
        })
      : Promise.resolve([] as JobFunction[]),
    specialtyCodes && specialtyCodes.length
      ? prisma.db.specialty.findMany({
          where: { code: { in: specialtyCodes }, is_deleted: false },
        })
      : Promise.resolve([] as Specialty[]),
  ]);

  if (jobFunctionCodes && jobFunctions.length !== jobFunctionCodes.length) {
    const found = new Set(jobFunctions.map((jf) => jf.code));
    const missing = jobFunctionCodes.filter((c) => !found.has(c));
    throw new BadRequestException(
      `Unknown job_function_codes: ${missing.join(', ')}`,
    );
  }
  if (specialtyCodes && specialties.length !== specialtyCodes.length) {
    const found = new Set(specialties.map((s) => s.code));
    const missing = specialtyCodes.filter((c) => !found.has(c));
    throw new BadRequestException(
      `Unknown specialty_codes: ${missing.join(', ')}`,
    );
  }

  return { jobFunctions, specialties };
}
