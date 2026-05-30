import { toSpecialtySummary } from '../specialty-catalog/specialty-catalog.public.js';
import type { ProfileDetail, ProfileSummary } from './profiles.includes.js';

export function toProfileSummary(profile: ProfileSummary) {
  return {
    id: profile.id,
    organization: {
      id: profile.organization.id,
      name: profile.organization.name,
      specialties: profile.organization.specialty_links.map((l) =>
        toSpecialtySummary(l.specialty),
      ),
      status: profile.organization.status,
    },
    roles: profile.roles.map((item) => item.role.code),
    branches: profile.branches.map((item) => ({
      id: item.branch.id,
      name: item.branch.name,
      city: item.branch.city,
      governorate: item.branch.governorate,
      is_main: item.branch.is_main,
    })),
  };
}

export function toProfileDetail(profile: ProfileDetail) {
  return {
    id: profile.id,
    first_name: profile.user.first_name,
    last_name: profile.user.last_name,
    email: profile.user.email,
    phone_number: profile.user.phone_number,
    executive_title: profile.executive_title,
    engagement_type: profile.engagement_type,
    roles: profile.roles.map((item) => item.role.code),
    organization: {
      id: profile.organization.id,
      name: profile.organization.name,
    },
    branches: profile.branches.map((item) => ({
      id: item.branch.id,
      name: item.branch.name,
      city: item.branch.city,
      governorate: item.branch.governorate,
      is_main: item.branch.is_main,
    })),
    job_functions: profile.job_functions.map((jf) => ({
      id: jf.job_function.id,
      code: jf.job_function.code,
      name: jf.job_function.name,
      is_clinical: jf.job_function.is_clinical,
    })),
    specialties: profile.specialty_links.map((sl) =>
      toSpecialtySummary(sl.specialty),
    ),
  };
}
