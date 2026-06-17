import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JobFunction, Specialty, Subspecialty } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { BranchScheduleDto } from './dto/staff.dto.js';
import { hhmmToMinutes } from './shift-time.helpers.js';

export interface ResolvedAccess {
  jobFunction: JobFunction | null;
  specialty: Specialty | null;
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

/**
 * Resolve a profile's single job function + single primary specialty by code.
 * Both are optional (non-clinical staff may have neither). Throws on an unknown
 * code. Subspecialties resolve separately via {@link resolveSubspecialties}.
 */
export async function resolveJobFunctionAndSpecialty(
  prisma: PrismaService,
  jobFunctionCode?: string | null,
  specialtyCode?: string | null,
): Promise<ResolvedAccess> {
  const [jobFunction, specialty] = await Promise.all([
    jobFunctionCode
      ? prisma.db.jobFunction.findFirst({ where: { code: jobFunctionCode } })
      : Promise.resolve(null),
    specialtyCode
      ? prisma.db.specialty.findFirst({
          where: { code: specialtyCode, is_deleted: false },
        })
      : Promise.resolve(null),
  ]);

  if (jobFunctionCode && !jobFunction) {
    throw new BadRequestException(
      `Unknown job_function_code: ${jobFunctionCode}`,
    );
  }
  if (specialtyCode && !specialty) {
    throw new BadRequestException(`Unknown specialty_code: ${specialtyCode}`);
  }

  return { jobFunction, specialty };
}

/**
 * Resolve subspecialty codes to their catalog rows, enforcing the parent
 * invariant: a subspecialty can only be assigned when a specialty is set, and
 * every resolved subspecialty must belong to that specialty.
 *
 * @param specialtyId the profile's effective specialty id (the one being set,
 *   or the existing one on an update that doesn't touch specialty).
 */
export async function resolveSubspecialties(
  prisma: PrismaService,
  subspecialtyCodes: string[] | undefined,
  specialtyId: string | null | undefined,
): Promise<Subspecialty[]> {
  const codes = [...new Set(subspecialtyCodes ?? [])];
  if (codes.length === 0) return [];
  if (!specialtyId) {
    throw new BadRequestException(
      'subspecialty_codes require a specialty to be set',
    );
  }
  const rows = await prisma.db.subspecialty.findMany({
    where: { code: { in: codes }, is_deleted: false },
  });
  const found = new Set(rows.map((r) => r.code));
  const missing = codes.filter((c) => !found.has(c));
  if (missing.length) {
    throw new BadRequestException(
      `Unknown subspecialty_codes: ${missing.join(', ')}`,
    );
  }
  const mismatched = rows.filter((r) => r.specialty_id !== specialtyId);
  if (mismatched.length) {
    throw new BadRequestException(
      `Subspecialties do not belong to the selected specialty: ${mismatched
        .map((r) => r.code)
        .join(', ')}`,
    );
  }
  return rows;
}
