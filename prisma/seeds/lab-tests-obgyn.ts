/**
 * OB/GYN lab-test / investigation catalog seed.
 *
 * A curated set of common OB/GYN laboratory and imaging investigations. Backs
 * the investigation type-ahead picker in the examination's Investigations
 * section (search by name OR code). System-wide (organization_id = null), like
 * specialties / diagnosis codes. Idempotent — keyed on (organization_id=null,
 * code). Doctor-typed tests not in this catalog are added at examination time
 * as org-scoped USER rows (added_by = the authoring profile).
 */

import { LabTestCategory, PrismaClient } from '@prisma/client';

const SPECIALTY_CODE = 'OBGYN';

interface LabTestSeed {
  code: string;
  name: string;
  category: LabTestCategory;
}

const TESTS: LabTestSeed[] = [
  // ---- Laboratory ----------------------------------------------------------
  { code: 'CBC', name: 'Complete blood count (CBC)', category: 'LAB' },
  { code: 'BLOOD_GROUP_RH', name: 'Blood group & Rh typing', category: 'LAB' },
  { code: 'BETA_HCG_QUANT', name: 'Beta-hCG (quantitative)', category: 'LAB' },
  { code: 'BETA_HCG_QUAL', name: 'Beta-hCG (qualitative / pregnancy test)', category: 'LAB' },
  { code: 'TSH', name: 'Thyroid stimulating hormone (TSH)', category: 'LAB' },
  { code: 'FT4', name: 'Free T4', category: 'LAB' },
  { code: 'FBS', name: 'Fasting blood sugar', category: 'LAB' },
  { code: 'OGTT', name: 'Oral glucose tolerance test (OGTT)', category: 'LAB' },
  { code: 'HBA1C', name: 'HbA1c', category: 'LAB' },
  { code: 'URINALYSIS', name: 'Urinalysis', category: 'LAB' },
  { code: 'URINE_CULTURE', name: 'Urine culture & sensitivity', category: 'LAB' },
  { code: 'HVS_CULTURE', name: 'High vaginal swab culture', category: 'LAB' },
  { code: 'PAP_SMEAR', name: 'Pap smear (cervical cytology)', category: 'LAB' },
  { code: 'HPV_DNA', name: 'HPV DNA test', category: 'LAB' },
  { code: 'RUBELLA_IGG', name: 'Rubella IgG', category: 'LAB' },
  { code: 'HEP_B_SAG', name: 'Hepatitis B surface antigen (HBsAg)', category: 'LAB' },
  { code: 'HIV', name: 'HIV screening', category: 'LAB' },
  { code: 'VDRL', name: 'VDRL / syphilis screening', category: 'LAB' },
  { code: 'FERRITIN', name: 'Serum ferritin', category: 'LAB' },
  { code: 'PROLACTIN', name: 'Serum prolactin', category: 'LAB' },
  { code: 'FSH_LH', name: 'FSH / LH', category: 'LAB' },
  { code: 'AMH', name: 'Anti-Mullerian hormone (AMH)', category: 'LAB' },
  { code: 'PROGESTERONE', name: 'Serum progesterone', category: 'LAB' },
  { code: 'CA125', name: 'CA-125', category: 'LAB' },
  { code: 'COAG_PROFILE', name: 'Coagulation profile (PT/INR, aPTT)', category: 'LAB' },
  // ---- Imaging -------------------------------------------------------------
  { code: 'PELVIC_US', name: 'Pelvic ultrasound', category: 'IMAGING' },
  { code: 'TVS', name: 'Transvaginal ultrasound', category: 'IMAGING' },
  { code: 'OB_US', name: 'Obstetric ultrasound', category: 'IMAGING' },
  { code: 'ANOMALY_SCAN', name: 'Anomaly scan (fetal anatomy)', category: 'IMAGING' },
  { code: 'GROWTH_SCAN', name: 'Growth scan', category: 'IMAGING' },
  { code: 'DOPPLER', name: 'Doppler ultrasound', category: 'IMAGING' },
  { code: 'NT_SCAN', name: 'Nuchal translucency scan', category: 'IMAGING' },
  { code: 'HSG', name: 'Hysterosalpingography (HSG)', category: 'IMAGING' },
  { code: 'MAMMOGRAPHY', name: 'Mammography', category: 'IMAGING' },
  { code: 'BREAST_US', name: 'Breast ultrasound', category: 'IMAGING' },
  { code: 'BONE_DENSITY', name: 'Bone densitometry (DEXA)', category: 'IMAGING' },
];

export async function seedObgynLabTests(prisma: PrismaClient): Promise<void> {
  const specialty = await prisma.specialty.findUnique({
    where: { code: SPECIALTY_CODE },
    select: { id: true },
  });
  const specialtyId = specialty?.id ?? null;

  for (const t of TESTS) {
    const existing = await prisma.labTest.findFirst({
      where: { organization_id: null, code: t.code },
      select: { id: true },
    });
    if (existing) {
      await prisma.labTest.update({
        where: { id: existing.id },
        data: {
          name: t.name,
          category: t.category,
          specialty_id: specialtyId,
          is_deleted: false,
          deleted_at: null,
        },
      });
    } else {
      await prisma.labTest.create({
        data: {
          organization_id: null,
          code: t.code,
          name: t.name,
          category: t.category,
          specialty_id: specialtyId,
        },
      });
    }
  }
  console.log(`✓ OB/GYN lab tests seeded (${TESTS.length})`);
}
