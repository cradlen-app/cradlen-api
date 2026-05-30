import { Prisma } from '@prisma/client';

export const INVITATION_FULL_INCLUDE = {
  roles: { include: { role: true } },
  branches: { include: { branch: true } },
  job_functions: { include: { job_function: true } },
  specialty_links: { include: { specialty: true } },
  invited_by: {
    select: { id: true, first_name: true, last_name: true, email: true },
  },
} satisfies Prisma.InvitationInclude;

export const INVITATION_PREVIEW_INCLUDE = {
  roles: { include: { role: true } },
  branches: { include: { branch: true } },
  job_functions: { include: { job_function: true } },
  specialty_links: { include: { specialty: true } },
  invited_by: {
    select: { first_name: true, last_name: true },
  },
  organization: {
    select: { id: true, name: true },
  },
} satisfies Prisma.InvitationInclude;

export type InvitationFull = Prisma.InvitationGetPayload<{
  include: typeof INVITATION_FULL_INCLUDE;
}>;

export type InvitationPreview = Prisma.InvitationGetPayload<{
  include: typeof INVITATION_PREVIEW_INCLUDE;
}>;
