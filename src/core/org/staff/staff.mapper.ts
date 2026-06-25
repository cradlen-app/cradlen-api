import { Prisma } from '@prisma/client';
import { minutesToHhmm } from './shift-time.helpers.js';

export const staffInclude = {
  user: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      email: true,
      phone_number: true,
    },
  },
  role: true,
  branches: {
    where: { branch: { is_deleted: false } },
    include: { branch: true },
  },
  job_function: true,
  specialty: true,
  subspecialty_links: { include: { subspecialty: true } },
  workingSchedules: {
    include: { days: { include: { shifts: true } } },
  },
} as const satisfies Prisma.ProfileInclude;

export type StaffProfileWithRelations = Prisma.ProfileGetPayload<{
  include: typeof staffInclude;
}>;

export function toStaffResponse(p: StaffProfileWithRelations) {
  return {
    profile_id: p.id,
    user_id: p.user.id,
    is_active: p.is_active,
    first_name: p.user.first_name,
    last_name: p.user.last_name,
    email: p.user.email,
    phone_number: p.user.phone_number,
    executive_title: p.executive_title,
    professional_title: p.professional_title,
    engagement_type: p.engagement_type,
    role: { id: p.role.id, name: p.role.name },
    branches: p.branches.map((b) => ({
      id: b.branch.id,
      name: b.branch.name,
      city: b.branch.city,
      governorate: b.branch.governorate,
    })),
    job_function: p.job_function
      ? {
          id: p.job_function.id,
          code: p.job_function.code,
          name: p.job_function.name,
          is_clinical: p.job_function.is_clinical,
        }
      : null,
    specialty: p.specialty
      ? { id: p.specialty.id, code: p.specialty.code, name: p.specialty.name }
      : null,
    subspecialties: p.subspecialty_links.map((sl) => ({
      id: sl.subspecialty.id,
      code: sl.subspecialty.code,
      name: sl.subspecialty.name,
      specialty_code: p.specialty?.code ?? '',
    })),
    schedule: p.workingSchedules.map((ws) => ({
      branch_id: ws.branch_id,
      days: ws.days.map((d) => ({
        day_of_week: d.day_of_week,
        shifts: d.shifts.map((s) => ({
          start_time: minutesToHhmm(s.start_minute),
          end_time: minutesToHhmm(s.end_minute),
        })),
      })),
    })),
  };
}
