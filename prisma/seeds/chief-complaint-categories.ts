/**
 * Chief complaint categories seed.
 *
 * Seeded per (specialty_code, care_path_code) combination.
 * care_path_code = null means the category applies to all care paths for the
 * specialty (general fallback). The endpoint returns care-path-specific
 * categories first; if none exist it falls back to the null-care_path rows.
 *
 * Care path codes must match exactly what is seeded in prisma/seed.ts:
 *   OBGYN_GENERAL, OBGYN_PREGNANCY, OBGYN_SURGICAL, OBGYN_INFERTILITY
 */

import { PrismaClient } from '@prisma/client';

interface CategorySpec {
  code: string;
  label: string;
  order: number;
}

interface CarePathCategories {
  specialtyCode: string;
  carePathCode: string | null;
  categories: CategorySpec[];
}

const OBGYN_COMPLAINT_CATEGORIES: CarePathCategories[] = [
  {
    specialtyCode: 'OBGYN',
    carePathCode: null, // General fallback — shown when no care path is selected
    categories: [
      { code: 'PELVIC_PAIN', label: 'Pelvic pain', order: 0 },
      { code: 'ABNORMAL_BLEEDING', label: 'Abnormal bleeding', order: 1 },
      { code: 'MENSTRUAL_IRREGULARITY', label: 'Menstrual irregularity', order: 2 },
      { code: 'VAGINAL_DISCHARGE', label: 'Vaginal discharge', order: 3 },
      { code: 'INFERTILITY', label: 'Infertility concern', order: 4 },
      { code: 'CONTRACEPTION', label: 'Contraception counselling', order: 5 },
      { code: 'OTHER', label: 'Other', order: 6 },
    ],
  },
  {
    specialtyCode: 'OBGYN',
    carePathCode: 'OBGYN_GENERAL',
    categories: [
      { code: 'PELVIC_PAIN', label: 'Pelvic pain', order: 0 },
      { code: 'ABNORMAL_BLEEDING', label: 'Abnormal bleeding', order: 1 },
      { code: 'MENSTRUAL_IRREGULARITY', label: 'Menstrual irregularity', order: 2 },
      { code: 'VAGINAL_DISCHARGE', label: 'Vaginal discharge', order: 3 },
      { code: 'INFERTILITY', label: 'Infertility concern', order: 4 },
      { code: 'CONTRACEPTION', label: 'Contraception counselling', order: 5 },
      { code: 'OTHER', label: 'Other', order: 6 },
    ],
  },
  {
    specialtyCode: 'OBGYN',
    carePathCode: 'OBGYN_PREGNANCY',
    categories: [
      { code: 'GESTATIONAL_AGE_CHECK', label: 'Gestational age check', order: 0 },
      { code: 'FETAL_MOVEMENT', label: 'Fetal movement concern', order: 1 },
      { code: 'PRE_ECLAMPSIA_SCREENING', label: 'Pre-eclampsia screening', order: 2 },
      { code: 'VAGINAL_DISCHARGE', label: 'Vaginal discharge', order: 3 },
      { code: 'ABNORMAL_BLEEDING', label: 'Abnormal bleeding', order: 4 },
      { code: 'OTHER', label: 'Other', order: 5 },
    ],
  },
  {
    specialtyCode: 'OBGYN',
    carePathCode: 'OBGYN_SURGICAL',
    categories: [
      { code: 'PRE_OPERATIVE_ASSESSMENT', label: 'Pre-operative assessment', order: 0 },
      { code: 'POST_OPERATIVE_FOLLOWUP', label: 'Post-operative follow-up', order: 1 },
      { code: 'SURGICAL_COMPLICATION', label: 'Surgical complication', order: 2 },
      { code: 'WOUND_CARE', label: 'Wound care', order: 3 },
      { code: 'OTHER', label: 'Other', order: 4 },
    ],
  },
  {
    specialtyCode: 'OBGYN',
    carePathCode: 'OBGYN_INFERTILITY',
    categories: [
      { code: 'CYCLE_TRACKING', label: 'Cycle tracking', order: 0 },
      { code: 'OVULATION_ISSUES', label: 'Ovulation issues', order: 1 },
      { code: 'HORMONAL_IMBALANCE', label: 'Hormonal imbalance', order: 2 },
      { code: 'RECURRENT_MISCARRIAGE', label: 'Recurrent miscarriage', order: 3 },
      { code: 'OTHER', label: 'Other', order: 4 },
    ],
  },
];

export async function seedChiefComplaintCategories(
  prisma: PrismaClient,
): Promise<void> {
  for (const group of OBGYN_COMPLAINT_CATEGORIES) {
    for (const cat of group.categories) {
      // Prisma can't use null in composite unique where — use findFirst + update/create
      const existing = await prisma.chiefComplaintCategory.findFirst({
        where: {
          specialty_code: group.specialtyCode,
          care_path_code: group.carePathCode,
          code: cat.code,
        },
      });

      if (existing) {
        await prisma.chiefComplaintCategory.update({
          where: { id: existing.id },
          data: {
            label: cat.label,
            order: cat.order,
            is_deleted: false,
            deleted_at: null,
          },
        });
      } else {
        await prisma.chiefComplaintCategory.create({
          data: {
            specialty_code: group.specialtyCode,
            care_path_code: group.carePathCode,
            code: cat.code,
            label: cat.label,
            order: cat.order,
          },
        });
      }
    }
  }
  console.log('✓ Chief complaint categories seeded');
}
