import { config } from 'dotenv';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';
import { seedBookVisitTemplate } from './seeds/book-visit.js';
import { seedObgynPatientHistoryTemplate } from './seeds/obgyn-patient-history.js';
import { seedObgynExaminationTemplate } from './seeds/obgyn-examination.js';
import { seedCarePathHistorySections } from './seeds/care-path-history-sections.js';
import { seedCarePathClinicalSurfaces } from './seeds/care-path-clinical-surfaces.js';
import { seedObgynDiagnosisCodes } from './seeds/diagnosis-codes-obgyn.js';
import { seedObgynLabTests } from './seeds/lab-tests-obgyn.js';
import { seedMedicalRepVisitTemplate } from './seeds/medical-rep-visit.js';
import { seedPrescriptionDefaultTemplate } from './seeds/prescription-default-template.js';

config({ path: '.env' });
config({
  path: `.env.${process.env.NODE_ENV ?? 'development'}`,
  override: true,
});

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Roles — authority tiers only. Job-level distinctions live on JobFunction below.
  const roles = ['OWNER', 'BRANCH_MANAGER', 'STAFF'];
  for (const code of roles) {
    await prisma.role.upsert({
      where: { code },
      update: { name: code },
      create: { code, name: code },
    });
  }

  // Job functions — what a profile actually does. Drives staff filtering and
  // function-aware authorization checks (e.g., financial endpoints require ACCOUNTANT).
  // Coarse roles only — DOCTOR (clinical) + the two non-clinical functions. The
  // clinical specialization lives in Specialty (which drives templates).
  const jobFunctions = [
    { code: 'DOCTOR', name: 'Doctor', is_clinical: true },
    { code: 'RECEPTIONIST', name: 'Receptionist', is_clinical: false },
    { code: 'ACCOUNTANT', name: 'Accountant', is_clinical: false },
  ];
  for (const jf of jobFunctions) {
    await prisma.jobFunction.upsert({
      where: { code: jf.code },
      update: { name: jf.name, is_clinical: jf.is_clinical },
      create: jf,
    });
  }

  // Plan tiers (limits) + their YEARLY price (EGP). Only YEARLY is offered for
  // now; the BillingInterval enum keeps MONTHLY for a later additive change.
  // All plans cap max_organizations at 1 — a tier is a single org grown by
  // branch add-ons, not multiple orgs ("network of centers" = many branches).
  const SUBSCRIPTION_PLANS: {
    plan: string;
    max_organizations: number;
    max_branches: number;
    max_staff: number;
    yearly_price: number;
  }[] = [
    {
      plan: 'free_trial',
      max_organizations: 1,
      max_branches: 1,
      max_staff: 5,
      yearly_price: 0,
    },
    {
      plan: 'individual',
      max_organizations: 1,
      max_branches: 1,
      max_staff: 2,
      yearly_price: 8000,
    },
    {
      plan: 'center',
      max_organizations: 1,
      max_branches: 1,
      max_staff: 10,
      yearly_price: 22000,
    },
    {
      plan: 'network',
      max_organizations: 1,
      max_branches: 3,
      max_staff: 25,
      yearly_price: 50000,
    },
  ];
  const planIdByCode: Record<string, string> = {};
  for (const p of SUBSCRIPTION_PLANS) {
    const planRow = await prisma.subscriptionPlan.upsert({
      where: { plan: p.plan },
      update: {
        max_organizations: p.max_organizations,
        max_branches: p.max_branches,
        max_staff: p.max_staff,
      },
      create: {
        plan: p.plan,
        max_organizations: p.max_organizations,
        max_branches: p.max_branches,
        max_staff: p.max_staff,
      },
    });
    planIdByCode[p.plan] = planRow.id;
    await prisma.planPrice.upsert({
      where: {
        subscription_plan_id_billing_interval_currency: {
          subscription_plan_id: planRow.id,
          billing_interval: 'YEARLY',
          currency: 'EGP',
        },
      },
      update: { price: p.yearly_price, is_active: true },
      create: {
        subscription_plan_id: planRow.id,
        billing_interval: 'YEARLY',
        price: p.yearly_price,
        currency: 'EGP',
        is_active: true,
      },
    });
  }

  // Add-ons: extra capacity that stacks on a base plan. Grant amount AND price
  // both vary per tier, so each (tier × kind) is its own catalog row. YEARLY.
  const ADD_ONS: {
    code: string;
    name: string;
    kind: 'BRANCH_BUNDLE' | 'EXTRA_USER';
    plan: string;
    delta_branches: number;
    delta_users: number;
    yearly_price: number;
  }[] = [
    {
      code: 'individual_extra_branch',
      name: 'Individual — extra branch (+2 users)',
      kind: 'BRANCH_BUNDLE',
      plan: 'individual',
      delta_branches: 1,
      delta_users: 2,
      yearly_price: 5000,
    },
    {
      code: 'center_extra_branch',
      name: 'Center — extra branch (+5 users)',
      kind: 'BRANCH_BUNDLE',
      plan: 'center',
      delta_branches: 1,
      delta_users: 5,
      yearly_price: 8000,
    },
    {
      code: 'network_extra_branch',
      name: 'Network — extra branch (+25 users)',
      kind: 'BRANCH_BUNDLE',
      plan: 'network',
      delta_branches: 1,
      delta_users: 25,
      yearly_price: 12000,
    },
    {
      code: 'individual_extra_user',
      name: 'Individual — extra user',
      kind: 'EXTRA_USER',
      plan: 'individual',
      delta_branches: 0,
      delta_users: 1,
      yearly_price: 2500,
    },
    {
      code: 'center_extra_user',
      name: 'Center — extra user',
      kind: 'EXTRA_USER',
      plan: 'center',
      delta_branches: 0,
      delta_users: 1,
      yearly_price: 2000,
    },
    {
      code: 'network_extra_user',
      name: 'Network — extra user',
      kind: 'EXTRA_USER',
      plan: 'network',
      delta_branches: 0,
      delta_users: 1,
      yearly_price: 1800,
    },
  ];
  for (const a of ADD_ONS) {
    const addOnRow = await prisma.addOn.upsert({
      where: { code: a.code },
      update: {
        name: a.name,
        kind: a.kind,
        subscription_plan_id: planIdByCode[a.plan],
        delta_branches: a.delta_branches,
        delta_users: a.delta_users,
        is_active: true,
      },
      create: {
        code: a.code,
        name: a.name,
        kind: a.kind,
        subscription_plan_id: planIdByCode[a.plan],
        delta_branches: a.delta_branches,
        delta_users: a.delta_users,
      },
    });
    await prisma.addOnPrice.upsert({
      where: {
        add_on_id_billing_interval_currency: {
          add_on_id: addOnRow.id,
          billing_interval: 'YEARLY',
          currency: 'EGP',
        },
      },
      update: { price: a.yearly_price, is_active: true },
      create: {
        add_on_id: addOnRow.id,
        billing_interval: 'YEARLY',
        price: a.yearly_price,
        currency: 'EGP',
        is_active: true,
      },
    });
  }

  // Specialty: OB/GYN
  const gynSpecialty = await prisma.specialty.upsert({
    where: { code: 'OBGYN' },
    update: { name: 'Obstetrics & Gynecology' },
    create: {
      name: 'Obstetrics & Gynecology',
      code: 'OBGYN',
      description: 'Obstetrics and Gynecology',
    },
  });

  // Subspecialties (fellowships) under OB/GYN. A doctor holds one primary
  // specialty (Profile.specialty_id) and optionally several of these.
  const obgynSubspecialties = [
    { code: 'REI', name: 'Reproductive Endocrinology & Infertility' },
    { code: 'MFM', name: 'Maternal-Fetal Medicine' },
    { code: 'GYN_ONCOLOGY', name: 'Gynecologic Oncology' },
    { code: 'UROGYNECOLOGY', name: 'Urogynecology' },
  ];
  const subspecialtyByCode = new Map<string, string>();
  for (const sub of obgynSubspecialties) {
    const row = await prisma.subspecialty.upsert({
      where: { code: sub.code },
      update: { name: sub.name, specialty_id: gynSpecialty.id },
      create: { code: sub.code, name: sub.name, specialty_id: gynSpecialty.id },
    });
    subspecialtyByCode.set(sub.code, row.id);
  }

  // Procedures — structured catalog of surgical procedures.
  const procedures = [
    { code: 'CESAREAN_SECTION', name: 'Cesarean Section' },
    { code: 'NORMAL_DELIVERY', name: 'Normal Delivery' },
    { code: 'D_AND_C', name: 'Dilation & Curettage' },
    { code: 'HYSTERECTOMY', name: 'Hysterectomy' },
    { code: 'LAPAROSCOPY', name: 'Laparoscopy' },
  ];
  for (const proc of procedures) {
    await prisma.procedure.upsert({
      where: { code: proc.code },
      update: { name: proc.name, specialty_id: gynSpecialty.id },
      create: {
        code: proc.code,
        name: proc.name,
        specialty_id: gynSpecialty.id,
      },
    });
  }

  // Journey Templates — upserted by (specialty_id, code)
  const pregnancyTemplate = await prisma.journeyTemplate.upsert({
    where: {
      specialty_id_code: { specialty_id: gynSpecialty.id, code: 'PREGNANCY' },
    },
    update: { name: 'Pregnancy Journey' },
    create: {
      specialty_id: gynSpecialty.id,
      code: 'PREGNANCY',
      name: 'Pregnancy Journey',
      type: 'PREGNANCY',
      description: 'Full antenatal and postnatal pregnancy pathway',
    },
  });

  const generalGynTemplate = await prisma.journeyTemplate.upsert({
    where: {
      specialty_id_code: { specialty_id: gynSpecialty.id, code: 'GENERAL_GYN' },
    },
    update: { name: 'General GYN Journey' },
    create: {
      specialty_id: gynSpecialty.id,
      code: 'GENERAL_GYN',
      name: 'General GYN Journey',
      type: 'GENERAL_GYN',
      description: 'General gynecology consultations and follow-ups',
    },
  });

  const surgicalTemplate = await prisma.journeyTemplate.upsert({
    where: {
      specialty_id_code: { specialty_id: gynSpecialty.id, code: 'SURGICAL' },
    },
    update: { name: 'Surgical Journey' },
    create: {
      specialty_id: gynSpecialty.id,
      code: 'SURGICAL',
      name: 'Surgical Journey',
      type: 'SURGICAL',
      description: 'Pre-operative, surgical, and post-operative care',
    },
  });

  const chronicTemplate = await prisma.journeyTemplate.upsert({
    where: {
      specialty_id_code: {
        specialty_id: gynSpecialty.id,
        code: 'CHRONIC_CONDITION',
      },
    },
    update: { name: 'Chronic Condition Journey' },
    create: {
      specialty_id: gynSpecialty.id,
      code: 'CHRONIC_CONDITION',
      name: 'Chronic Condition Journey',
      type: 'CHRONIC_CONDITION',
      description: 'Long-term management of chronic gynecological conditions',
    },
  });

  // Episode Templates — upsert by template + order pair
  const pregnancyEpisodes = [
    { name: 'First Trimester', order: 1 },
    { name: 'Second Trimester', order: 2 },
    { name: 'Third Trimester', order: 3 },
    { name: 'Delivery', order: 4 },
    { name: 'Postpartum', order: 5 },
  ];
  for (const ep of pregnancyEpisodes) {
    const existing = await prisma.episodeTemplate.findFirst({
      where: { journey_template_id: pregnancyTemplate.id, order: ep.order },
    });
    if (!existing) {
      await prisma.episodeTemplate.create({
        data: { journey_template_id: pregnancyTemplate.id, ...ep },
      });
    }
  }

  const generalGynEpisodes = [{ name: 'General Consultation', order: 1 }];
  for (const ep of generalGynEpisodes) {
    const existing = await prisma.episodeTemplate.findFirst({
      where: { journey_template_id: generalGynTemplate.id, order: ep.order },
    });
    if (!existing) {
      await prisma.episodeTemplate.create({
        data: { journey_template_id: generalGynTemplate.id, ...ep },
      });
    }
  }

  const surgicalEpisodes = [
    { name: 'Pre-operative', order: 1 },
    { name: 'Surgery', order: 2 },
    { name: 'Post-operative', order: 3 },
  ];
  for (const ep of surgicalEpisodes) {
    const existing = await prisma.episodeTemplate.findFirst({
      where: { journey_template_id: surgicalTemplate.id, order: ep.order },
    });
    if (!existing) {
      await prisma.episodeTemplate.create({
        data: { journey_template_id: surgicalTemplate.id, ...ep },
      });
    }
  }

  const chronicEpisodes = [
    { name: 'Diagnosis & Stabilization', order: 1 },
    { name: 'Ongoing Management', order: 2 },
  ];
  for (const ep of chronicEpisodes) {
    const existing = await prisma.episodeTemplate.findFirst({
      where: { journey_template_id: chronicTemplate.id, order: ep.order },
    });
    if (!existing) {
      await prisma.episodeTemplate.create({
        data: { journey_template_id: chronicTemplate.id, ...ep },
      });
    }
  }

  // Care paths — UMR redesign (PR1 additive). System-seeded (organization_id = null, is_system = true).
  // Replaces the JourneyTemplateType enum with a queryable, tenant-extendable taxonomy.
  // The legacy JourneyTemplate / EpisodeTemplate seeds above stay in place until PR2 migrates consumers.
  // Each care path resolves to exactly one JourneyTemplate at booking time.
  // OBGYN_INFERTILITY currently has no dedicated template — falls back to
  // CHRONIC_CONDITION until a dedicated template is authored.
  const carePathCatalog = [
    {
      code: 'OBGYN_GENERAL',
      name: 'General GYN',
      description: 'General gynecology consultations and follow-ups',
      order: 1,
      journey_template_id: generalGynTemplate.id,
      episodes: [
        {
          code: 'GENERAL_CONSULTATION',
          name: 'General Consultation',
          order: 1,
        },
      ],
    },
    {
      code: 'OBGYN_PREGNANCY',
      name: 'Pregnancy',
      description: 'Antenatal and postnatal pregnancy care pathway',
      order: 2,
      journey_template_id: pregnancyTemplate.id,
      episodes: [
        { code: 'FIRST_TRIMESTER', name: 'First Trimester', order: 1 },
        { code: 'SECOND_TRIMESTER', name: 'Second Trimester', order: 2 },
        { code: 'THIRD_TRIMESTER', name: 'Third Trimester', order: 3 },
        { code: 'DELIVERY', name: 'Delivery', order: 4 },
        { code: 'POSTPARTUM', name: 'Postpartum', order: 5 },
      ],
    },
    {
      code: 'OBGYN_SURGICAL',
      name: 'Surgical',
      description:
        'Pre-operative, surgical, and post-operative gynecologic care',
      order: 3,
      journey_template_id: surgicalTemplate.id,
      episodes: [
        { code: 'PRE_OPERATIVE', name: 'Pre-operative', order: 1 },
        { code: 'SURGERY', name: 'Surgery', order: 2 },
        { code: 'POST_OPERATIVE', name: 'Post-operative', order: 3 },
      ],
    },
    {
      code: 'OBGYN_INFERTILITY',
      name: 'Infertility',
      description: 'Infertility evaluation and treatment',
      order: 4,
      journey_template_id: chronicTemplate.id,
      episodes: [
        { code: 'EVALUATION', name: 'Evaluation', order: 1 },
        { code: 'TREATMENT', name: 'Treatment', order: 2 },
        { code: 'FOLLOW_UP', name: 'Follow-up', order: 3 },
      ],
    },
  ];

  for (const cp of carePathCatalog) {
    // findFirst + create/update because organization_id is nullable in the composite unique index
    // and Postgres treats NULLs as distinct, so .upsert() can't safely match system rows.
    let carePath = await prisma.carePath.findFirst({
      where: {
        specialty_id: gynSpecialty.id,
        organization_id: null,
        code: cp.code,
      },
    });
    if (!carePath) {
      carePath = await prisma.carePath.create({
        data: {
          specialty_id: gynSpecialty.id,
          organization_id: null,
          is_system: true,
          code: cp.code,
          name: cp.name,
          description: cp.description,
          order: cp.order,
          journey_template_id: cp.journey_template_id,
        },
      });
    } else {
      carePath = await prisma.carePath.update({
        where: { id: carePath.id },
        data: {
          name: cp.name,
          description: cp.description,
          order: cp.order,
          is_system: true,
          journey_template_id: cp.journey_template_id,
        },
      });
    }
    for (const ep of cp.episodes) {
      const existing = await prisma.carePathEpisode.findFirst({
        where: {
          care_path_id: carePath.id,
          organization_id: null,
          code: ep.code,
        },
      });
      if (!existing) {
        await prisma.carePathEpisode.create({
          data: {
            care_path_id: carePath.id,
            organization_id: null,
            is_system: true,
            code: ep.code,
            name: ep.name,
            order: ep.order,
          },
        });
      } else {
        await prisma.carePathEpisode.update({
          where: { id: existing.id },
          data: { name: ep.name, order: ep.order, is_system: true },
        });
      }
    }
  }

  // Scope the infertility care path to the REI subspecialty, so a booking that
  // pins subspecialty_code=REI resolves it over the specialty-level fallback.
  const reiId = subspecialtyByCode.get('REI');
  if (reiId) {
    await prisma.carePath.updateMany({
      where: {
        specialty_id: gynSpecialty.id,
        organization_id: null,
        code: 'OBGYN_INFERTILITY',
      },
      data: { subspecialty_id: reiId },
    });
  }

  // Lab tests — global catalog. Categorized as LAB | IMAGING | OTHER.
  const labTests = [
    { code: 'CBC', name: 'Complete Blood Count', category: 'LAB' as const },
    { code: 'URINALYSIS', name: 'Urinalysis', category: 'LAB' as const },
    {
      code: 'BLOOD_GROUP_RH',
      name: 'Blood Group & Rh Factor',
      category: 'LAB' as const,
    },
    { code: 'HBA1C', name: 'HbA1c', category: 'LAB' as const },
    {
      code: 'OGTT',
      name: 'Oral Glucose Tolerance Test',
      category: 'LAB' as const,
    },
    { code: 'TSH', name: 'TSH', category: 'LAB' as const },
    {
      code: 'BETA_HCG_QUANT',
      name: 'Beta hCG Quantitative',
      category: 'LAB' as const,
    },
    {
      code: 'GBS_SWAB',
      name: 'Group B Streptococcus Swab',
      category: 'LAB' as const,
    },
    {
      code: 'OB_ULTRASOUND',
      name: 'Obstetric Ultrasound',
      category: 'IMAGING' as const,
    },
    {
      code: 'ANOMALY_SCAN',
      name: 'Anomaly Scan',
      category: 'IMAGING' as const,
    },
    {
      code: 'DOPPLER_STUDY',
      name: 'Doppler Study',
      category: 'IMAGING' as const,
    },
    { code: 'NST', name: 'Non-Stress Test', category: 'OTHER' as const },
  ];
  for (const test of labTests) {
    const existing = await prisma.labTest.findFirst({
      where: { organization_id: null, code: test.code },
    });
    if (!existing) {
      await prisma.labTest.create({
        data: { ...test, specialty_id: gynSpecialty.id },
      });
    } else {
      await prisma.labTest.update({
        where: { id: existing.id },
        data: { ...test, specialty_id: gynSpecialty.id },
      });
    }
  }

  await seedCarePathHistorySections(prisma);
  await seedCarePathClinicalSurfaces(prisma);
  await seedObgynDiagnosisCodes(prisma);
  await seedObgynLabTests(prisma);
  await seedBookVisitTemplate(prisma);
  await seedObgynPatientHistoryTemplate(prisma);
  await seedObgynExaminationTemplate(prisma);
  await seedMedicalRepVisitTemplate(prisma);
  await seedPrescriptionDefaultTemplate(prisma);

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
