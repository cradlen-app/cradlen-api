import type { Prisma } from '@prisma/client';
import {
  toSpecialtySummary,
  type SpecialtySummary,
} from '../specialty-catalog/specialty-catalog.public.js';

export const ORGANIZATION_WITH_SPECIALTIES_INCLUDE = {
  specialty_links: { include: { specialty: true } },
} satisfies Prisma.OrganizationInclude;

export type OrganizationWithSpecialties = Prisma.OrganizationGetPayload<{
  include: typeof ORGANIZATION_WITH_SPECIALTIES_INCLUDE;
}>;

/**
 * Strips the raw `specialty_links` join rows and replaces them with a flat
 * `specialties: SpecialtySummary[]` projection. Also drops the internal
 * `logo_object_key` — callers attach a presigned `logo_image_url` instead.
 * Single source of truth for the organization response shape.
 */
export function toOrganizationResponse(
  organization: OrganizationWithSpecialties,
): Omit<OrganizationWithSpecialties, 'specialty_links' | 'logo_object_key'> & {
  specialties: SpecialtySummary[];
} {
  const {
    specialty_links,
    logo_object_key: _logoObjectKey,
    ...rest
  } = organization;
  void _logoObjectKey;
  return {
    ...rest,
    specialties: specialty_links.map((l) => toSpecialtySummary(l.specialty)),
  };
}
