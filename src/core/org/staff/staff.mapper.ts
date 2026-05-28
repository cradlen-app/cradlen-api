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
  roles: { include: { role: true } },
  branches: {
    where: { branch: { is_deleted: false } },
    include: { branch: true },
  },
  job_functions: { include: { job_function: true } },
  specialty_links: { include: { specialty: true } },
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
    first_name: p.user.first_name,
    last_name: p.user.last_name,
    email: p.user.email,
    phone_number: p.user.phone_number,
    executive_title: p.executive_title,
    engagement_type: p.engagement_type,
    roles: p.roles.map((r) => ({ id: r.role.id, name: r.role.name })),
    branches: p.branches.map((b) => ({
      id: b.branch.id,
      name: b.branch.name,
      city: b.branch.city,
      governorate: b.branch.governorate,
    })),
    job_functions: p.job_functions.map((jf) => ({
      id: jf.job_function.id,
      code: jf.job_function.code,
      name: jf.job_function.name,
      is_clinical: jf.job_function.is_clinical,
    })),
    specialties: p.specialty_links.map((sl) => ({
      id: sl.specialty.id,
      code: sl.specialty.code,
      name: sl.specialty.name,
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
