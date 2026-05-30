import type { Prisma } from '@prisma/client';
import {
  toSpecialtySummary,
  type SpecialtySummary,
} from '../specialties/specialties.public.js';

export const ORGANIZATION_WITH_SPECIALTIES_INCLUDE = {
  specialty_links: { include: { specialty: true } },
} satisfies Prisma.OrganizationInclude;

type OrganizationWithSpecialties = Prisma.OrganizationGetPayload<{
  include: typeof ORGANIZATION_WITH_SPECIALTIES_INCLUDE;
}>;

/**
 * Strips the raw `specialty_links` join rows and replaces them with a flat
 * `specialties: SpecialtySummary[]` projection. Single source of truth for the
 * organization response shape.
 */
export function toOrganizationResponse(
  organization: OrganizationWithSpecialties,
): Omit<OrganizationWithSpecialties, 'specialty_links'> & {
  specialties: SpecialtySummary[];
} {
  const { specialty_links, ...rest } = organization;
  return {
    ...rest,
    specialties: specialty_links.map((l) => toSpecialtySummary(l.specialty)),
  };
}
