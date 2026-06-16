import { Prisma } from '@prisma/client';

export const PROFILE_SUMMARY_INCLUDE = {
  organization: {
    include: {
      specialty_links: {
        where: { specialty: { is_deleted: false } },
        include: {
          specialty: { select: { id: true, code: true, name: true } },
        },
      },
    },
  },
  role: true,
  branches: {
    where: { branch: { is_deleted: false } },
    include: { branch: true },
  },
} satisfies Prisma.ProfileInclude;

export const PROFILE_DETAIL_INCLUDE = {
  user: true,
  organization: true,
  role: true,
  branches: {
    where: { branch: { is_deleted: false } },
    include: { branch: true },
  },
  job_function: true,
  specialty_links: {
    where: { specialty: { is_deleted: false } },
    include: { specialty: true },
  },
} satisfies Prisma.ProfileInclude;

export type ProfileSummary = Prisma.ProfileGetPayload<{
  include: typeof PROFILE_SUMMARY_INCLUDE;
}>;

export type ProfileDetail = Prisma.ProfileGetPayload<{
  include: typeof PROFILE_DETAIL_INCLUDE;
}>;
