import { config } from 'dotenv';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';

config({ path: '.env' });
config({
  path: `.env.${process.env.NODE_ENV ?? 'development'}`,
  override: true,
});

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Roles — authority tiers only. Job-level distinctions live on JobFunction below.
  const roles = ['OWNER', 'BRANCH_MANAGER', 'STAFF', 'EXTERNAL'];
  for (const name of roles) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // Job functions — what a profile actually does. Drives staff filtering and
  // function-aware authorization checks (e.g., financial endpoints require ACCOUNTANT).
  const jobFunctions = [
    { code: 'OBGYN', name: 'OB/GYN', is_clinical: true },
    { code: 'ANESTHESIOLOGIST', name: 'Anesthesiologist', is_clinical: true },
    { code: 'PEDIATRICIAN', name: 'Pediatrician', is_clinical: true },
    { code: 'OTHER_DOCTOR', name: 'Other Doctor', is_clinical: true },
    { code: 'NURSE', name: 'Nurse', is_clinical: true },
    { code: 'ASSISTANT', name: 'Assistant', is_clinical: true },
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

  await prisma.subscriptionPlan.upsert({
    where: { plan: 'free_trial' },
    update: { max_organizations: 1, max_branches: 1, max_staff: 5 },
    create: { plan: 'free_trial', max_organizations: 1, max_branches: 1, max_staff: 5 },
  });
  await prisma.subscriptionPlan.upsert({
    where: { plan: 'plus' },
    update: { max_organizations: 3, max_branches: 3, max_staff: 15 },
    create: { plan: 'plus', max_organizations: 3, max_branches: 3, max_staff: 15 },
  });
  await prisma.subscriptionPlan.upsert({
    where: { plan: 'pro' },
    update: { max_organizations: 5, max_branches: 5, max_staff: 25 },
    create: { plan: 'pro', max_organizations: 5, max_branches: 5, max_staff: 25 },
  });
  await prisma.subscriptionPlan.upsert({
    where: { plan: 'enterprise' },
    update: { max_organizations: 10, max_branches: 10, max_staff: 100 },
    create: { plan: 'enterprise', max_organizations: 10, max_branches: 10, max_staff: 100 },
  });

  // Specialty: GYN
  const gynSpecialty = await prisma.specialty.upsert({
    where: { code: 'GYN' },
    update: {},
    create: { name: 'Gynecology', code: 'GYN', description: 'Obstetrics and Gynecology' },
  });

  // Procedures — structured catalog used by CalendarEvent.procedure_id when type=SURGERY.
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
      create: { code: proc.code, name: proc.name, specialty_id: gynSpecialty.id },
    });
  }

  // Journey Templates
  const pregnancyTemplate = await prisma.journeyTemplate.upsert({
    where: { name: 'Pregnancy Journey' },
    update: {},
    create: {
      specialty_id: gynSpecialty.id,
      name: 'Pregnancy Journey',
      type: 'PREGNANCY',
      description: 'Full antenatal and postnatal pregnancy pathway',
    },
  });

  const generalGynTemplate = await prisma.journeyTemplate.upsert({
    where: { name: 'General GYN Journey' },
    update: {},
    create: {
      specialty_id: gynSpecialty.id,
      name: 'General GYN Journey',
      type: 'GENERAL_GYN',
      description: 'General gynecology consultations and follow-ups',
    },
  });

  const surgicalTemplate = await prisma.journeyTemplate.upsert({
    where: { name: 'Surgical Journey' },
    update: {},
    create: {
      specialty_id: gynSpecialty.id,
      name: 'Surgical Journey',
      type: 'SURGICAL',
      description: 'Pre-operative, surgical, and post-operative care',
    },
  });

  const chronicTemplate = await prisma.journeyTemplate.upsert({
    where: { name: 'Chronic Condition Journey' },
    update: {},
    create: {
      specialty_id: gynSpecialty.id,
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

  // Medications — global catalog (organization_id = null). OB/GYN-relevant set.
  const medications = [
    { code: 'FOLIC_ACID_5MG', name: 'Folic Acid 5mg', generic_name: 'folic acid', form: 'tablet', strength: '5mg' },
    { code: 'PARACETAMOL_500', name: 'Paracetamol 500mg', generic_name: 'paracetamol', form: 'tablet', strength: '500mg' },
    { code: 'METHYLDOPA_250', name: 'Methyldopa 250mg', generic_name: 'methyldopa', form: 'tablet', strength: '250mg' },
    { code: 'LABETALOL_100', name: 'Labetalol 100mg', generic_name: 'labetalol', form: 'tablet', strength: '100mg' },
    { code: 'NIFEDIPINE_20', name: 'Nifedipine 20mg', generic_name: 'nifedipine', form: 'tablet', strength: '20mg' },
    { code: 'IRON_SULFATE_325', name: 'Ferrous Sulfate 325mg', generic_name: 'ferrous sulfate', form: 'tablet', strength: '325mg' },
    { code: 'CALCIUM_CARBONATE_500', name: 'Calcium Carbonate 500mg', generic_name: 'calcium carbonate', form: 'tablet', strength: '500mg' },
    { code: 'VITAMIN_D3_1000IU', name: 'Vitamin D3 1000 IU', generic_name: 'cholecalciferol', form: 'tablet', strength: '1000IU' },
    { code: 'MAGNESIUM_SULFATE', name: 'Magnesium Sulfate 4g/20ml', generic_name: 'magnesium sulfate', form: 'injection', strength: '4g/20ml' },
    { code: 'PROGESTERONE_200', name: 'Progesterone 200mg', generic_name: 'progesterone', form: 'capsule', strength: '200mg' },
    { code: 'OXYTOCIN_10IU', name: 'Oxytocin 10 IU/ml', generic_name: 'oxytocin', form: 'injection', strength: '10IU/ml' },
    { code: 'DEXAMETHASONE_6', name: 'Dexamethasone 6mg', generic_name: 'dexamethasone', form: 'injection', strength: '6mg' },
    { code: 'CLOTRIMAZOLE_PESSARY', name: 'Clotrimazole Pessary 500mg', generic_name: 'clotrimazole', form: 'pessary', strength: '500mg' },
    { code: 'METRONIDAZOLE_500', name: 'Metronidazole 500mg', generic_name: 'metronidazole', form: 'tablet', strength: '500mg' },
    { code: 'ONDANSETRON_8', name: 'Ondansetron 8mg', generic_name: 'ondansetron', form: 'tablet', strength: '8mg' },
  ];
  for (const med of medications) {
    const existing = await prisma.medication.findFirst({
      where: { organization_id: null, code: med.code },
    });
    if (!existing) {
      await prisma.medication.create({ data: { ...med } });
    } else {
      await prisma.medication.update({ where: { id: existing.id }, data: { ...med } });
    }
  }

  // Lab tests — global catalog. Categorized as LAB | IMAGING | OTHER.
  const labTests = [
    { code: 'CBC', name: 'Complete Blood Count', category: 'LAB' as const },
    { code: 'URINALYSIS', name: 'Urinalysis', category: 'LAB' as const },
    { code: 'BLOOD_GROUP_RH', name: 'Blood Group & Rh Factor', category: 'LAB' as const },
    { code: 'HBA1C', name: 'HbA1c', category: 'LAB' as const },
    { code: 'OGTT', name: 'Oral Glucose Tolerance Test', category: 'LAB' as const },
    { code: 'TSH', name: 'TSH', category: 'LAB' as const },
    { code: 'BETA_HCG_QUANT', name: 'Beta hCG Quantitative', category: 'LAB' as const },
    { code: 'GBS_SWAB', name: 'Group B Streptococcus Swab', category: 'LAB' as const },
    { code: 'OB_ULTRASOUND', name: 'Obstetric Ultrasound', category: 'IMAGING' as const },
    { code: 'ANOMALY_SCAN', name: 'Anomaly Scan', category: 'IMAGING' as const },
    { code: 'DOPPLER_STUDY', name: 'Doppler Study', category: 'IMAGING' as const },
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

  // Form Templates — system clinical encounter template per specialty.
  // Frontend renders strictly from the template's published version schema.
  const gynEncounterSchema = {
    sections: [
      {
        code: 'exam_findings',
        label: { en: 'Examination Findings' },
        fields: [
          { code: 'general_findings', type: 'LONG_TEXT' },
          { code: 'cardiovascular_findings', type: 'LONG_TEXT' },
          { code: 'respiratory_findings', type: 'LONG_TEXT' },
          { code: 'menstrual_findings', type: 'LONG_TEXT' },
          { code: 'abdominal_findings', type: 'LONG_TEXT' },
          { code: 'pelvic_findings', type: 'LONG_TEXT' },
          { code: 'breast_findings', type: 'LONG_TEXT' },
          { code: 'extremities_findings', type: 'LONG_TEXT' },
          { code: 'neurological_findings', type: 'LONG_TEXT' },
          { code: 'skin_findings', type: 'LONG_TEXT' },
        ],
      },
    ],
  };

  const gynEncounterTemplate = await prisma.formTemplate.upsert({
    where: { code: 'SYSTEM_GYN_CLINICAL_ENCOUNTER_V1' },
    update: {},
    create: {
      name: 'GYN Clinical Encounter (System)',
      code: 'SYSTEM_GYN_CLINICAL_ENCOUNTER_V1',
      description: 'Default clinical encounter template for OB/GYN, shipped by Cradlen.',
      scope: 'SYSTEM',
      surface: 'CLINICAL_ENCOUNTER',
      specialty_id: gynSpecialty.id,
    },
  });

  const existingV1 = await prisma.formTemplateVersion.findUnique({
    where: {
      template_id_version_number: {
        template_id: gynEncounterTemplate.id,
        version_number: 1,
      },
    },
  });
  if (!existingV1) {
    await prisma.formTemplateVersion.create({
      data: {
        template_id: gynEncounterTemplate.id,
        version_number: 1,
        status: 'PUBLISHED',
        schema: gynEncounterSchema,
        published_at: new Date(),
      },
    });
  }

  // OB/GYN — General GYN booking (BOOKING surface). Frontend renders this to drive
  // the booking screen. Submission still posts to /visits/book or /visits/book-rep
  // based on visitor_kind; this template is rendering-only.
  const gynBookingSchema = {
    sections: [
      {
        code: 'visitor_classification',
        label: { en: 'Visitor', ar: 'الزائر' },
        fields: [
          {
            code: 'visitor_kind',
            type: 'SINGLE_SELECT',
            required: true,
            label: { en: 'Visitor type', ar: 'نوع الزائر' },
            options: [
              { code: 'PATIENT', label: { en: 'Patient', ar: 'مريضة' } },
              {
                code: 'MEDICAL_REP',
                label: { en: 'Medical Representative', ar: 'مندوب طبي' },
              },
            ],
          },
        ],
      },
      {
        code: 'visit_metadata',
        label: { en: 'Visit details', ar: 'تفاصيل الزيارة' },
        fields: [
          {
            code: 'branch_id',
            type: 'SINGLE_SELECT',
            required: true,
            label: { en: 'Branch', ar: 'الفرع' },
          },
          {
            code: 'assigned_doctor_id',
            type: 'SINGLE_SELECT',
            required: true,
            label: { en: 'Doctor', ar: 'الطبيب' },
          },
          {
            code: 'scheduled_at',
            type: 'DATETIME',
            required: true,
            label: { en: 'Scheduled at', ar: 'موعد الزيارة' },
          },
          {
            code: 'priority',
            type: 'SINGLE_SELECT',
            required: true,
            label: { en: 'Priority', ar: 'الأولوية' },
            options: [
              { code: 'NORMAL', label: { en: 'Normal', ar: 'عادية' } },
              {
                code: 'EMERGENCY',
                label: { en: 'Emergency', ar: 'طارئة' },
              },
            ],
          },
          {
            code: 'visit_type',
            type: 'SINGLE_SELECT',
            label: { en: 'Visit type', ar: 'نوع الزيارة' },
            options: [
              { code: 'VISIT', label: { en: 'New visit', ar: 'زيارة جديدة' } },
              {
                code: 'FOLLOW_UP',
                label: { en: 'Follow-up', ar: 'متابعة' },
              },
            ],
            show_if: { field: 'visitor_kind', equals: 'PATIENT' },
          },
        ],
      },
      {
        code: 'patient_lookup',
        label: { en: 'Patient', ar: 'المريضة' },
        show_if: { field: 'visitor_kind', equals: 'PATIENT' },
        fields: [
          {
            code: 'is_new_patient',
            type: 'BOOLEAN',
            required: true,
            label: { en: 'New patient?', ar: 'مريضة جديدة؟' },
          },
          {
            code: 'patient_id',
            type: 'TEXT',
            label: { en: 'Existing patient', ar: 'مريضة موجودة' },
            show_if: { field: 'is_new_patient', equals: false },
          },
        ],
      },
      {
        code: 'patient_new',
        label: { en: 'New patient details', ar: 'بيانات مريضة جديدة' },
        show_if: { field: 'is_new_patient', equals: true },
        fields: [
          {
            code: 'national_id',
            type: 'TEXT',
            required: true,
            regex: '^\\d{14}$',
            label: { en: 'National ID', ar: 'الرقم القومي' },
          },
          {
            code: 'full_name',
            type: 'TEXT',
            required: true,
            min_length: 3,
            max_length: 200,
            label: { en: 'Full name', ar: 'الاسم الكامل' },
          },
          {
            code: 'date_of_birth',
            type: 'DATE',
            required: true,
            label: { en: 'Date of birth', ar: 'تاريخ الميلاد' },
          },
          {
            code: 'phone_number',
            type: 'TEXT',
            required: true,
            regex: '^\\+?\\d{10,15}$',
            label: { en: 'Phone number', ar: 'رقم الهاتف' },
          },
          {
            code: 'address',
            type: 'LONG_TEXT',
            required: true,
            max_length: 500,
            label: { en: 'Address', ar: 'العنوان' },
          },
          {
            code: 'is_married',
            type: 'BOOLEAN',
            label: { en: 'Married?', ar: 'متزوجة؟' },
          },
          {
            code: 'husband_name',
            type: 'TEXT',
            max_length: 200,
            label: { en: 'Husband name', ar: 'اسم الزوج' },
            show_if: { field: 'is_married', equals: true },
          },
        ],
      },
      {
        code: 'intake_optional',
        label: { en: 'Initial intake (optional)', ar: 'الاستقبال المبدئي (اختياري)' },
        show_if: { field: 'visitor_kind', equals: 'PATIENT' },
        fields: [
          {
            code: 'chief_complaint',
            type: 'LONG_TEXT',
            max_length: 5000,
            label: { en: 'Chief complaint', ar: 'الشكوى الرئيسية' },
          },
          {
            code: 'vitals_systolic_bp',
            type: 'INTEGER',
            min: 60,
            max: 260,
            label: { en: 'Systolic BP', ar: 'الضغط الانقباضي' },
          },
          {
            code: 'vitals_diastolic_bp',
            type: 'INTEGER',
            min: 30,
            max: 180,
            label: { en: 'Diastolic BP', ar: 'الضغط الانبساطي' },
          },
          {
            code: 'vitals_pulse',
            type: 'INTEGER',
            min: 30,
            max: 250,
            label: { en: 'Pulse', ar: 'النبض' },
          },
          {
            code: 'vitals_temperature_c',
            type: 'NUMBER',
            min: 30,
            max: 45,
            label: { en: 'Temperature (°C)', ar: 'درجة الحرارة (°م)' },
          },
          {
            code: 'vitals_weight_kg',
            type: 'NUMBER',
            min: 1,
            max: 400,
            label: { en: 'Weight (kg)', ar: 'الوزن (كجم)' },
          },
          {
            code: 'vitals_height_cm',
            type: 'NUMBER',
            min: 30,
            max: 250,
            label: { en: 'Height (cm)', ar: 'الطول (سم)' },
          },
        ],
      },
      {
        code: 'rep_lookup',
        label: { en: 'Medical representative', ar: 'المندوب الطبي' },
        show_if: { field: 'visitor_kind', equals: 'MEDICAL_REP' },
        fields: [
          {
            code: 'is_new_rep',
            type: 'BOOLEAN',
            required: true,
            label: { en: 'New rep?', ar: 'مندوب جديد؟' },
          },
          {
            code: 'medical_rep_id',
            type: 'TEXT',
            label: { en: 'Existing rep', ar: 'مندوب موجود' },
            show_if: { field: 'is_new_rep', equals: false },
          },
        ],
      },
      {
        code: 'rep_new',
        label: { en: 'New rep details', ar: 'بيانات مندوب جديد' },
        show_if: { field: 'is_new_rep', equals: true },
        fields: [
          {
            code: 'rep_full_name',
            type: 'TEXT',
            required: true,
            min_length: 3,
            max_length: 200,
            label: { en: 'Full name', ar: 'الاسم الكامل' },
          },
          {
            code: 'rep_company',
            type: 'TEXT',
            required: true,
            max_length: 200,
            label: { en: 'Company', ar: 'الشركة' },
          },
          {
            code: 'rep_phone',
            type: 'TEXT',
            max_length: 50,
            label: { en: 'Phone', ar: 'الهاتف' },
          },
          {
            code: 'rep_email',
            type: 'TEXT',
            regex: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
            label: { en: 'Email', ar: 'البريد الإلكتروني' },
          },
          {
            code: 'rep_territory',
            type: 'TEXT',
            max_length: 100,
            label: { en: 'Territory', ar: 'المنطقة' },
          },
        ],
      },
      {
        code: 'notes_section',
        label: { en: 'Notes', ar: 'ملاحظات' },
        fields: [
          {
            code: 'notes',
            type: 'LONG_TEXT',
            max_length: 2000,
            label: { en: 'Notes', ar: 'ملاحظات' },
          },
        ],
      },
    ],
  };

  const gynBookingTemplate = await prisma.formTemplate.upsert({
    where: { code: 'SYSTEM_OBGYN_BOOKING_GENERAL_V1' },
    update: {},
    create: {
      name: 'OB/GYN — General GYN Booking (System)',
      code: 'SYSTEM_OBGYN_BOOKING_GENERAL_V1',
      description:
        'Default booking form for OB/GYN General GYN journey. Branches on visitor_kind for patient vs medical-rep flows.',
      scope: 'SYSTEM',
      surface: 'BOOKING',
      specialty_id: gynSpecialty.id,
    },
  });

  const existingBookingV1 = await prisma.formTemplateVersion.findUnique({
    where: {
      template_id_version_number: {
        template_id: gynBookingTemplate.id,
        version_number: 1,
      },
    },
  });
  if (!existingBookingV1) {
    await prisma.formTemplateVersion.create({
      data: {
        template_id: gynBookingTemplate.id,
        version_number: 1,
        status: 'PUBLISHED',
        schema: gynBookingSchema,
        published_at: new Date(),
      },
    });
  }

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
