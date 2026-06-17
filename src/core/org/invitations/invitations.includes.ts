import { Prisma } from '@prisma/client';

export const INVITATION_FULL_INCLUDE = {
  role: true,
  branches: { include: { branch: true } },
  job_function: true,
  specialty: true,
  subspecialty_links: { include: { subspecialty: true } },
  invited_by: {
    select: { id: true, first_name: true, last_name: true, email: true },
  },
} satisfies Prisma.InvitationInclude;

export const INVITATION_PREVIEW_INCLUDE = {
  role: true,
  branches: { include: { branch: true } },
  job_function: true,
  specialty: true,
  subspecialty_links: { include: { subspecialty: true } },
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
