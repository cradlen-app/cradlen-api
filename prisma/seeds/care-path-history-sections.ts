/**
 * Care-path → patient-history section mapping seed.
 *
 * Drives which embedded `history_*` sections the OB/GYN examination surfaces
 * once the doctor picks a care path. The `section_code` values match the
 * (history_-prefixed) FormSection codes in the `obgyn_examination` template
 * (see prisma/seeds/obgyn-examination.ts → composeSections / HISTORY_SECTION_PREFIX).
 *
 * Surfaced to the frontend on `CarePathDto.history_section_codes` by
 * CarePathsService — no separate endpoint. Idempotent (upsert by the
 * (specialty_code, care_path_code, section_code) unique key).
 *
 * Care path codes must match prisma/seed.ts:
 *   OBGYN_GENERAL, OBGYN_PREGNANCY, OBGYN_SURGICAL, OBGYN_INFERTILITY
 */

import { PrismaClient } from '@prisma/client';

const PREFIX = 'history_';

interface CarePathHistoryMap {
  specialtyCode: string;
  carePathCode: string;
  /** Base history section codes (un-prefixed); the prefix is applied here. */
  sectionCodes: string[];
}

const OBGYN_CARE_PATH_HISTORY: CarePathHistoryMap[] = [
  {
    specialtyCode: 'OBGYN',
    carePathCode: 'OBGYN_GENERAL',
    sectionCodes: [
      'menstrual_history',
      'gynecologic_conditions',
      'sexual_history',
      'contraceptives',
      'screening_vaccinations',
      'medical_chronic_illnesses',
      'allergies',
      'medications',
    ],
  },
  {
    specialtyCode: 'OBGYN',
    carePathCode: 'OBGYN_PREGNANCY',
    sectionCodes: [
      'obstetric_summary',
      'pregnancies',
      'menstrual_history',
      'medical_chronic_illnesses',
      'allergies',
      'medications',
      'family_members',
    ],
  },
  {
    specialtyCode: 'OBGYN',
    carePathCode: 'OBGYN_SURGICAL',
    sectionCodes: [
      'gynecologic_procedures',
      'gynecologic_conditions',
      'non_gyn_surgeries',
      'medical_chronic_illnesses',
      'allergies',
      'medications',
    ],
  },
  {
    specialtyCode: 'OBGYN',
    carePathCode: 'OBGYN_INFERTILITY',
    sectionCodes: [
      'fertility_history',
      'sexual_history',
      'menstrual_history',
      'obstetric_summary',
      'contraceptives',
      'family_members',
    ],
  },
];

export async function seedCarePathHistorySections(
  prisma: PrismaClient,
): Promise<void> {
  for (const group of OBGYN_CARE_PATH_HISTORY) {
    for (let i = 0; i < group.sectionCodes.length; i++) {
      const sectionCode = `${PREFIX}${group.sectionCodes[i]}`;
      await prisma.carePathHistorySection.upsert({
        where: {
          specialty_code_care_path_code_section_code: {
            specialty_code: group.specialtyCode,
            care_path_code: group.carePathCode,
            section_code: sectionCode,
          },
        },
        update: { order: i, is_deleted: false, deleted_at: null },
        create: {
          specialty_code: group.specialtyCode,
          care_path_code: group.carePathCode,
          section_code: sectionCode,
          order: i,
        },
      });
    }
  }
  console.log('✓ Care-path history sections seeded');
}
