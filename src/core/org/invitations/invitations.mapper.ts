import type { Prisma } from '@prisma/client';
import { toSpecialtySummary } from '../specialty-catalog/specialty-catalog.public.js';
import { minutesToHhmm } from '../staff/shift-time.helpers.js';
import type {
  InvitationFull,
  InvitationPreview,
} from './invitations.includes.js';

type WorkingScheduleRow = Prisma.WorkingScheduleGetPayload<{
  include: {
    branch: { select: { id: true; name: true } };
    days: { include: { shifts: true } };
  };
}>;

export function toInvitationResponse(
  invitation: InvitationFull,
  workingSchedule?: WorkingScheduleRow[] | null,
) {
  return {
    id: invitation.id,
    organization_id: invitation.organization_id,
    email: invitation.email,
    first_name: invitation.first_name,
    last_name: invitation.last_name,
    phone_number: invitation.phone_number,
    executive_title: invitation.executive_title,
    engagement_type: invitation.engagement_type,
    status: invitation.status,
    invited_at: invitation.created_at,
    expires_at: invitation.expires_at,
    accepted_at: invitation.accepted_at,
    invited_by: {
      id: invitation.invited_by.id,
      first_name: invitation.invited_by.first_name,
      last_name: invitation.invited_by.last_name,
      email: invitation.invited_by.email,
    },
    roles: invitation.roles.map((item) => ({
      id: item.role.id,
      name: item.role.name,
    })),
    branches: invitation.branches.map((item) => ({
      id: item.branch.id,
      name: item.branch.name,
      city: item.branch.city,
      governorate: item.branch.governorate,
    })),
    job_functions: invitation.job_functions.map((item) => ({
      id: item.job_function.id,
      code: item.job_function.code,
      name: item.job_function.name,
    })),
    specialties: invitation.specialty_links.map((item) =>
      toSpecialtySummary(item.specialty),
    ),
    ...(workingSchedule !== undefined && {
      working_schedule:
        workingSchedule?.map((ws) => ({
          branch: ws.branch,
          days: ws.days.map((d) => ({
            day_of_week: d.day_of_week,
            shifts: d.shifts.map((s) => ({
              start_time: minutesToHhmm(s.start_minute),
              end_time: minutesToHhmm(s.end_minute),
            })),
          })),
        })) ?? null,
    }),
  };
}

export function toInvitationPreviewResponse(invitation: InvitationPreview) {
  return {
    id: invitation.id,
    status: invitation.status,
    expires_at: invitation.expires_at,
    email: invitation.email,
    first_name: invitation.first_name,
    last_name: invitation.last_name,
    executive_title: invitation.executive_title,
    engagement_type: invitation.engagement_type,
    organization: {
      id: invitation.organization.id,
      name: invitation.organization.name,
    },
    invited_by: {
      first_name: invitation.invited_by.first_name,
      last_name: invitation.invited_by.last_name,
    },
    roles: invitation.roles.map((r) => ({
      id: r.role.id,
      name: r.role.name,
    })),
    branches: invitation.branches.map((b) => ({
      id: b.branch.id,
      name: b.branch.name,
      city: b.branch.city,
      governorate: b.branch.governorate,
    })),
    job_functions: invitation.job_functions.map((j) => ({
      id: j.job_function.id,
      code: j.job_function.code,
      name: j.job_function.name,
    })),
    specialties: invitation.specialty_links.map((s) =>
      toSpecialtySummary(s.specialty),
    ),
  };
}
