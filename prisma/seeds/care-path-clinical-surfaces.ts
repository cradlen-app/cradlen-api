/**
 * Care-path → journey clinical surface mapping seed.
 *
 * Declares, per care path, the form template that backs the patient's
 * active-journey tab in the visit workspace (e.g. the pregnancy profile +
 * per-visit maternal/fetal surveillance). A care path with a row here renders
 * one extra "journey" tab; a care path with none renders no extra tab.
 *
 * Surfaced to the frontend on the active-journey descriptor
 * (`GET /v1/visits/:visitId/journey` → `clinical_surface`) by JourneysService —
 * mirrors how CarePathHistorySection feeds `CarePathDto.history_section_codes`.
 *
 * Currently SEEDED EMPTY: no care path declares a surface yet, so the mechanism
 * is dormant (regression-safe). The pregnancy clinical vertical (deferred) adds
 * the OBGYN_PREGNANCY row + the matching `obgyn_pregnancy` template.
 *
 * Idempotent (upsert by the (specialty_code, care_path_code) unique key).
 */

import { PrismaClient } from '@prisma/client';

interface CarePathClinicalSurfaceMap {
  specialtyCode: string;
  carePathCode: string;
  templateCode: string;
  label: string;
  order: number;
}

const OBGYN_CARE_PATH_SURFACES: CarePathClinicalSurfaceMap[] = [
  // Deferred follow-up (pregnancy vertical) will add e.g.:
  // { specialtyCode: 'OBGYN', carePathCode: 'OBGYN_PREGNANCY',
  //   templateCode: 'obgyn_pregnancy', label: 'Pregnancy', order: 0 },
];

export async function seedCarePathClinicalSurfaces(
  prisma: PrismaClient,
): Promise<void> {
  for (const surface of OBGYN_CARE_PATH_SURFACES) {
    await prisma.carePathClinicalSurface.upsert({
      where: {
        specialty_code_care_path_code: {
          specialty_code: surface.specialtyCode,
          care_path_code: surface.carePathCode,
        },
      },
      update: {
        template_code: surface.templateCode,
        label: surface.label,
        order: surface.order,
        is_deleted: false,
        deleted_at: null,
      },
      create: {
        specialty_code: surface.specialtyCode,
        care_path_code: surface.carePathCode,
        template_code: surface.templateCode,
        label: surface.label,
        order: surface.order,
      },
    });
  }
  console.log('✓ Care-path clinical surfaces seeded');
}
