/**
 * OB/GYN ICD-10 diagnosis catalog seed.
 *
 * A curated subset of ICD-10-CM codes relevant to OB/GYN practice (modelled on
 * the CMS "ICD-10 Clinical Concepts for OB/GYN" set), grouped by clinical
 * concept. Backs the diagnosis type-ahead picker in the examination's
 * Provisional Diagnosis section (search by code OR description). Idempotent —
 * upsert by `code`. System-wide (no organization scope), like specialties /
 * care paths.
 *
 * Not exhaustive: the table is designed so a full ICD-10-CM import can be
 * layered on later without schema changes.
 */

import { PrismaClient } from '@prisma/client';

const SPECIALTY = 'OBGYN';

interface DiagnosisSeed {
  code: string;
  description: string;
  chapter: string;
  /** Category/header codes (non-leaf) are not billable. Default true. */
  billable?: boolean;
  keywords?: string;
}

const CODES: DiagnosisSeed[] = [
  // ---- Supervision of pregnancy --------------------------------------------
  { code: 'Z34.00', description: 'Encounter for supervision of normal first pregnancy, unspecified trimester', chapter: 'Pregnancy supervision', keywords: 'antenatal anc prenatal' },
  { code: 'Z34.90', description: 'Encounter for supervision of normal pregnancy, unspecified, unspecified trimester', chapter: 'Pregnancy supervision', keywords: 'antenatal anc prenatal' },
  { code: 'Z34.80', description: 'Encounter for supervision of other normal pregnancy, unspecified trimester', chapter: 'Pregnancy supervision' },
  { code: 'O09.90', description: 'Supervision of high-risk pregnancy, unspecified, unspecified trimester', chapter: 'Pregnancy supervision', keywords: 'high risk' },
  { code: 'O09.30', description: 'Supervision of pregnancy with insufficient antenatal care, unspecified trimester', chapter: 'Pregnancy supervision' },
  { code: 'Z32.01', description: 'Encounter for pregnancy test, result positive', chapter: 'Pregnancy supervision', keywords: 'pregnancy test' },
  { code: 'Z3A.00', description: 'Weeks of gestation of pregnancy not specified', chapter: 'Pregnancy supervision', billable: false },

  // ---- Pregnancy complications ---------------------------------------------
  { code: 'O21.0', description: 'Mild hyperemesis gravidarum', chapter: 'Pregnancy complications', keywords: 'vomiting nausea' },
  { code: 'O21.1', description: 'Hyperemesis gravidarum with metabolic disturbance', chapter: 'Pregnancy complications' },
  { code: 'O13.9', description: 'Gestational hypertension without significant proteinuria, unspecified trimester', chapter: 'Pregnancy complications', keywords: 'high blood pressure htn' },
  { code: 'O14.90', description: 'Unspecified pre-eclampsia, unspecified trimester', chapter: 'Pregnancy complications', keywords: 'preeclampsia' },
  { code: 'O14.10', description: 'Severe pre-eclampsia, unspecified trimester', chapter: 'Pregnancy complications' },
  { code: 'O15.9', description: 'Eclampsia, unspecified as to time period', chapter: 'Pregnancy complications' },
  { code: 'O24.419', description: 'Gestational diabetes mellitus in pregnancy, unspecified control', chapter: 'Pregnancy complications', keywords: 'gdm diabetes sugar' },
  { code: 'O26.20', description: 'Pregnancy care for patient with recurrent pregnancy loss, unspecified trimester', chapter: 'Pregnancy complications', keywords: 'miscarriage' },
  { code: 'O20.0', description: 'Threatened abortion', chapter: 'Pregnancy complications', keywords: 'bleeding' },
  { code: 'O03.9', description: 'Complete or unspecified spontaneous abortion without complication', chapter: 'Pregnancy complications', keywords: 'miscarriage' },
  { code: 'O00.90', description: 'Unspecified ectopic pregnancy without intrauterine pregnancy', chapter: 'Pregnancy complications', keywords: 'tubal' },
  { code: 'O46.90', description: 'Antepartum hemorrhage, unspecified, unspecified trimester', chapter: 'Pregnancy complications', keywords: 'bleeding' },
  { code: 'O44.10', description: 'Placenta previa with hemorrhage, unspecified trimester', chapter: 'Pregnancy complications' },
  { code: 'O36.5990', description: 'Maternal care for other known or suspected poor fetal growth, unspecified', chapter: 'Pregnancy complications', keywords: 'iugr growth restriction' },
  { code: 'O40.9XX0', description: 'Polyhydramnios, unspecified trimester, not applicable or unspecified', chapter: 'Pregnancy complications', keywords: 'amniotic fluid' },
  { code: 'O41.00X0', description: 'Oligohydramnios, unspecified trimester, not applicable or unspecified', chapter: 'Pregnancy complications', keywords: 'amniotic fluid low' },
  { code: 'O42.90', description: 'Premature rupture of membranes, unspecified, unspecified as to length of time', chapter: 'Pregnancy complications', keywords: 'prom rupture membranes' },
  { code: 'O47.00', description: 'False labor before 37 completed weeks of gestation, unspecified trimester', chapter: 'Pregnancy complications', keywords: 'braxton' },
  { code: 'O48.0', description: 'Post-term pregnancy', chapter: 'Pregnancy complications', keywords: 'prolonged' },
  { code: 'O60.0', description: 'Preterm labor without delivery', chapter: 'Pregnancy complications', keywords: 'premature' },

  // ---- Delivery / puerperium -----------------------------------------------
  { code: 'O80', description: 'Encounter for full-term uncomplicated delivery', chapter: 'Delivery', billable: false, keywords: 'normal vaginal' },
  { code: 'O82', description: 'Encounter for cesarean delivery without indication', chapter: 'Delivery', billable: false, keywords: 'c-section cs' },
  { code: 'O70.1', description: 'Second degree perineal laceration during delivery', chapter: 'Delivery', keywords: 'tear' },
  { code: 'O72.1', description: 'Other immediate postpartum hemorrhage', chapter: 'Delivery', keywords: 'pph bleeding' },
  { code: 'Z39.2', description: 'Encounter for routine postpartum follow-up', chapter: 'Delivery', keywords: 'postnatal' },

  // ---- Menstrual / bleeding ------------------------------------------------
  { code: 'N91.2', description: 'Amenorrhea, unspecified', chapter: 'Menstrual disorders', keywords: 'absent periods' },
  { code: 'N91.5', description: 'Oligomenorrhea, unspecified', chapter: 'Menstrual disorders', keywords: 'infrequent periods' },
  { code: 'N92.0', description: 'Excessive and frequent menstruation with regular cycle', chapter: 'Menstrual disorders', keywords: 'menorrhagia heavy' },
  { code: 'N92.1', description: 'Excessive and frequent menstruation with irregular cycle', chapter: 'Menstrual disorders', keywords: 'metrorrhagia' },
  { code: 'N92.6', description: 'Irregular menstruation, unspecified', chapter: 'Menstrual disorders' },
  { code: 'N93.8', description: 'Other specified abnormal uterine and vaginal bleeding', chapter: 'Menstrual disorders', keywords: 'aub' },
  { code: 'N93.9', description: 'Abnormal uterine and vaginal bleeding, unspecified', chapter: 'Menstrual disorders', keywords: 'aub spotting' },
  { code: 'N94.6', description: 'Dysmenorrhea, unspecified', chapter: 'Menstrual disorders', keywords: 'painful periods cramps' },
  { code: 'N94.1', description: 'Dyspareunia', chapter: 'Menstrual disorders', keywords: 'painful intercourse' },
  { code: 'E28.2', description: 'Polycystic ovarian syndrome', chapter: 'Menstrual disorders', keywords: 'pcos' },

  // ---- Pelvic pain / inflammatory ------------------------------------------
  { code: 'N94.89', description: 'Other specified conditions associated with female genital organs and menstrual cycle', chapter: 'Pelvic conditions' },
  { code: 'R10.2', description: 'Pelvic and perineal pain', chapter: 'Pelvic conditions', keywords: 'pelvic pain' },
  { code: 'N73.9', description: 'Female pelvic inflammatory disease, unspecified', chapter: 'Pelvic conditions', keywords: 'pid' },
  { code: 'N70.91', description: 'Salpingitis, unspecified', chapter: 'Pelvic conditions' },
  { code: 'N76.0', description: 'Acute vaginitis', chapter: 'Pelvic conditions', keywords: 'discharge infection' },
  { code: 'N77.1', description: 'Vaginitis, vulvitis and vulvovaginitis in diseases classified elsewhere', chapter: 'Pelvic conditions' },
  { code: 'B37.3', description: 'Candidiasis of vulva and vagina', chapter: 'Pelvic conditions', keywords: 'thrush yeast' },
  { code: 'A59.01', description: 'Trichomonal vulvovaginitis', chapter: 'Pelvic conditions' },

  // ---- Gynecology — structural ---------------------------------------------
  { code: 'N80.0', description: 'Endometriosis of the uterus', chapter: 'Gynecology', keywords: 'endometriosis' },
  { code: 'N80.9', description: 'Endometriosis, unspecified', chapter: 'Gynecology', keywords: 'endometriosis' },
  { code: 'N83.0', description: 'Follicular cyst of ovary', chapter: 'Gynecology', keywords: 'ovarian cyst' },
  { code: 'N83.20', description: 'Unspecified ovarian cysts', chapter: 'Gynecology', keywords: 'ovarian cyst' },
  { code: 'D25.9', description: 'Leiomyoma of uterus, unspecified', chapter: 'Gynecology', keywords: 'fibroid myoma' },
  { code: 'N84.0', description: 'Polyp of corpus uteri', chapter: 'Gynecology', keywords: 'endometrial polyp' },
  { code: 'N81.10', description: 'Cystocele, unspecified', chapter: 'Gynecology', keywords: 'prolapse' },
  { code: 'N81.2', description: 'Incomplete uterovaginal prolapse', chapter: 'Gynecology', keywords: 'prolapse' },
  { code: 'N85.00', description: 'Endometrial hyperplasia, unspecified', chapter: 'Gynecology' },
  { code: 'N87.9', description: 'Dysplasia of cervix uteri, unspecified', chapter: 'Gynecology', keywords: 'cin cervical dysplasia' },
  { code: 'R87.619', description: 'Unspecified abnormal cytological findings in specimens from cervix uteri', chapter: 'Gynecology', keywords: 'abnormal pap smear' },

  // ---- Menopause -----------------------------------------------------------
  { code: 'N95.1', description: 'Menopausal and female climacteric states', chapter: 'Menopause', keywords: 'hot flashes menopause' },
  { code: 'N95.0', description: 'Postmenopausal bleeding', chapter: 'Menopause', keywords: 'pmb bleeding' },
  { code: 'N95.2', description: 'Postmenopausal atrophic vaginitis', chapter: 'Menopause' },

  // ---- Infertility ---------------------------------------------------------
  { code: 'N97.0', description: 'Female infertility associated with anovulation', chapter: 'Infertility', keywords: 'subfertility' },
  { code: 'N97.1', description: 'Female infertility of tubal origin', chapter: 'Infertility' },
  { code: 'N97.9', description: 'Female infertility, unspecified', chapter: 'Infertility', keywords: 'subfertility' },
  { code: 'Z31.41', description: 'Encounter for fertility testing', chapter: 'Infertility' },

  // ---- Breast --------------------------------------------------------------
  { code: 'N63.0', description: 'Unspecified lump in unspecified breast', chapter: 'Breast', keywords: 'breast lump mass' },
  { code: 'N64.4', description: 'Mastodynia', chapter: 'Breast', keywords: 'breast pain' },
  { code: 'N61.0', description: 'Mastitis without abscess', chapter: 'Breast', keywords: 'breast infection' },

  // ---- Contraception / screening / encounters ------------------------------
  { code: 'Z30.011', description: 'Encounter for initial prescription of contraceptive pills', chapter: 'Contraception', keywords: 'ocp birth control' },
  { code: 'Z30.014', description: 'Encounter for initial prescription of intrauterine contraceptive device', chapter: 'Contraception', keywords: 'iud coil' },
  { code: 'Z30.40', description: 'Encounter for surveillance of contraceptives, unspecified', chapter: 'Contraception' },
  { code: 'Z30.430', description: 'Encounter for insertion of intrauterine contraceptive device', chapter: 'Contraception', keywords: 'iud insertion' },
  { code: 'Z01.419', description: 'Encounter for gynecological examination without abnormal findings', chapter: 'Screening', keywords: 'well woman checkup' },
  { code: 'Z12.4', description: 'Encounter for screening for malignant neoplasm of cervix', chapter: 'Screening', keywords: 'pap smear cervical screening' },
  { code: 'Z11.51', description: 'Encounter for screening for human papillomavirus (HPV)', chapter: 'Screening', keywords: 'hpv' },
  { code: 'Z12.31', description: 'Encounter for screening mammogram for malignant neoplasm of breast', chapter: 'Screening', keywords: 'mammogram' },
];

export async function seedObgynDiagnosisCodes(
  prisma: PrismaClient,
): Promise<void> {
  for (const c of CODES) {
    await prisma.diagnosisCode.upsert({
      where: { code: c.code },
      update: {
        description: c.description,
        chapter: c.chapter,
        specialty_code: SPECIALTY,
        billable: c.billable ?? true,
        keywords: c.keywords ?? null,
        source: 'SYSTEM',
        is_deleted: false,
        deleted_at: null,
      },
      create: {
        code: c.code,
        description: c.description,
        chapter: c.chapter,
        specialty_code: SPECIALTY,
        billable: c.billable ?? true,
        keywords: c.keywords ?? null,
        source: 'SYSTEM',
      },
    });
  }
  console.log(`✓ OB/GYN diagnosis codes seeded (${CODES.length})`);
}
