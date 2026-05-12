/**
 * OB/GYN Book-Visit template seed.
 *
 * Authored in code; the seed is the source of truth (templates are
 * code-managed, not admin-managed). Re-running this is idempotent — upserts
 * are keyed on (template.code, version) for the template, (template_id, code)
 * for sections, (section_id, code) for fields. The is_active pointer flips
 * atomically.
 *
 * Section-level `visible` predicates keyed on the SYSTEM-bound `visitor_type`
 * discriminator drive UI rendering. Cross-namespace `forbidden` predicates on
 * every contained field are auto-derived from the section visibility so the
 * server enforces the same exclusivity the UI shows.
 */

import { PrismaClient } from '@prisma/client';
import {
  validateBinding,
} from '../../src/builder/fields/allowed-paths.js';
import { assertValidConfig } from '../../src/builder/fields/field-config.schema.js';
import { FIELD_TYPES } from '../../src/builder/fields/field-type.registry.js';
import type { Predicate } from '../../src/builder/rules/predicates.js';

const TEMPLATE_CODE = 'obgyn_book_visit';
const TEMPLATE_VERSION = 1;

interface FieldSpec {
  code: string;
  label: string;
  type: keyof typeof FIELD_TYPES;
  required?: boolean;
  binding?: { namespace: string; path: string | null };
  config?: { ui?: any; validation?: any; logic?: any };
}

interface SectionSpec {
  code: string;
  name: string;
  /** Optional `visible` predicate gating the entire section. */
  visibleWhen?: { eq: Record<string, unknown> };
  /**
   * When set, every field inside this section gets an auto-emitted
   * `forbidden` predicate covering the other discriminator values. E.g. for a
   * section visible_when visitor_type=PATIENT, fields in it become forbidden
   * when visitor_type=MEDICAL_REP.
   */
  exclusivityKey?: { field: string; thisValue: string; otherValues: string[] };
  fields: FieldSpec[];
}

const SECTIONS: SectionSpec[] = [
  {
    code: 'search',
    name: 'Search',
    fields: [
      {
        code: 'patient_search',
        label: 'Find patient',
        type: 'ENTITY_SEARCH',
        binding: { namespace: 'LOOKUP', path: 'patient_id' },
        config: {
          ui: { placeholder: 'Search by name or national ID' },
          logic: {
            entity: 'patient',
            predicates: [
              { effect: 'visible', when: { eq: { visitor_type: 'PATIENT' } } },
            ] satisfies Predicate[],
          },
        },
      },
      {
        code: 'medical_rep_search',
        label: 'Find medical rep',
        type: 'ENTITY_SEARCH',
        binding: { namespace: 'LOOKUP', path: 'medical_rep_id' },
        config: {
          ui: { placeholder: 'Search by name or company' },
          logic: {
            entity: 'medical_rep',
            predicates: [
              {
                effect: 'visible',
                when: { eq: { visitor_type: 'MEDICAL_REP' } },
              },
            ] satisfies Predicate[],
          },
        },
      },
    ],
  },
  {
    code: 'visit_metadata',
    name: 'Visit metadata',
    fields: [
      {
        code: 'visitor_type',
        label: 'Visitor type',
        type: 'SELECT',
        required: true,
        binding: { namespace: 'SYSTEM', path: 'visitor_type' },
        config: {
          validation: {
            options: [
              { code: 'PATIENT', label: 'Patient' },
              { code: 'MEDICAL_REP', label: 'Medical rep' },
            ],
          },
          logic: { is_discriminator: true },
        },
      },
      {
        code: 'scheduled_at_patient',
        label: 'Scheduled at',
        type: 'DATETIME',
        binding: { namespace: 'VISIT', path: 'scheduled_at' },
        config: {
          logic: {
            predicates: [
              { effect: 'visible', when: { eq: { visitor_type: 'PATIENT' } } },
              { effect: 'required', when: { eq: { visitor_type: 'PATIENT' } } },
            ] satisfies Predicate[],
          },
        },
      },
      {
        code: 'scheduled_at_rep',
        label: 'Scheduled at',
        type: 'DATETIME',
        binding: { namespace: 'MEDICAL_REP', path: 'scheduled_at' },
        config: {
          logic: {
            predicates: [
              {
                effect: 'visible',
                when: { eq: { visitor_type: 'MEDICAL_REP' } },
              },
              {
                effect: 'required',
                when: { eq: { visitor_type: 'MEDICAL_REP' } },
              },
            ] satisfies Predicate[],
          },
        },
      },
      {
        code: 'priority_patient',
        label: 'Priority',
        type: 'SELECT',
        binding: { namespace: 'VISIT', path: 'priority' },
        config: {
          validation: {
            options: [
              { code: 'NORMAL', label: 'Normal' },
              { code: 'EMERGENCY', label: 'Emergency' },
            ],
          },
          logic: {
            predicates: [
              { effect: 'visible', when: { eq: { visitor_type: 'PATIENT' } } },
              { effect: 'required', when: { eq: { visitor_type: 'PATIENT' } } },
            ] satisfies Predicate[],
          },
        },
      },
      {
        code: 'priority_rep',
        label: 'Priority',
        type: 'SELECT',
        binding: { namespace: 'MEDICAL_REP', path: 'priority' },
        config: {
          validation: {
            options: [
              { code: 'NORMAL', label: 'Normal' },
              { code: 'EMERGENCY', label: 'Emergency' },
            ],
          },
          logic: {
            predicates: [
              {
                effect: 'visible',
                when: { eq: { visitor_type: 'MEDICAL_REP' } },
              },
            ] satisfies Predicate[],
          },
        },
      },
      {
        code: 'assigned_doctor_patient',
        label: 'Assigned doctor',
        type: 'ENTITY_SEARCH',
        binding: { namespace: 'VISIT', path: 'assigned_doctor_id' },
        config: {
          logic: {
            entity: 'doctor',
            predicates: [
              { effect: 'visible', when: { eq: { visitor_type: 'PATIENT' } } },
              { effect: 'required', when: { eq: { visitor_type: 'PATIENT' } } },
            ] satisfies Predicate[],
          },
        },
      },
      {
        code: 'assigned_doctor_rep',
        label: 'Assigned doctor',
        type: 'ENTITY_SEARCH',
        binding: { namespace: 'MEDICAL_REP', path: 'assigned_doctor_id' },
        config: {
          logic: {
            entity: 'doctor',
            predicates: [
              {
                effect: 'visible',
                when: { eq: { visitor_type: 'MEDICAL_REP' } },
              },
              {
                effect: 'required',
                when: { eq: { visitor_type: 'MEDICAL_REP' } },
              },
            ] satisfies Predicate[],
          },
        },
      },
      {
        code: 'appointment_type',
        label: 'Appointment type',
        type: 'SELECT',
        binding: { namespace: 'VISIT', path: 'appointment_type' },
        config: {
          validation: {
            options: [
              { code: 'VISIT', label: 'Visit' },
              { code: 'FOLLOW_UP', label: 'Follow-up' },
            ],
          },
          logic: {
            predicates: [
              { effect: 'visible', when: { eq: { visitor_type: 'PATIENT' } } },
              { effect: 'required', when: { eq: { visitor_type: 'PATIENT' } } },
            ] satisfies Predicate[],
          },
        },
      },
    ],
  },
  {
    code: 'patient_info',
    name: 'Patient info',
    visibleWhen: { eq: { visitor_type: 'PATIENT' } },
    exclusivityKey: {
      field: 'visitor_type',
      thisValue: 'PATIENT',
      otherValues: ['MEDICAL_REP'],
    },
    fields: [
      {
        code: 'full_name',
        label: 'Full name',
        type: 'TEXT',
        binding: { namespace: 'PATIENT', path: 'full_name' },
        config: { validation: { maxLength: 200 } },
      },
      {
        code: 'national_id',
        label: 'National ID',
        type: 'TEXT',
        binding: { namespace: 'PATIENT', path: 'national_id' },
        config: { validation: { maxLength: 50 } },
      },
      {
        code: 'date_of_birth',
        label: 'Date of birth',
        type: 'DATE',
        binding: { namespace: 'PATIENT', path: 'date_of_birth' },
      },
      {
        code: 'phone_number',
        label: 'Phone number',
        type: 'TEXT',
        binding: { namespace: 'PATIENT', path: 'phone_number' },
        config: { validation: { maxLength: 30 } },
      },
      {
        code: 'marital_status',
        label: 'Marital status',
        type: 'SELECT',
        binding: { namespace: 'PATIENT', path: 'marital_status' },
        config: {
          validation: {
            options: [
              { code: 'SINGLE', label: 'Single' },
              { code: 'MARRIED', label: 'Married' },
              { code: 'DIVORCED', label: 'Divorced' },
              { code: 'WIDOWED', label: 'Widowed' },
              { code: 'SEPARATED', label: 'Separated' },
              { code: 'ENGAGED', label: 'Engaged' },
              { code: 'UNKNOWN', label: 'Unknown' },
            ],
          },
        },
      },
      {
        code: 'spouse_full_name',
        label: 'Spouse full name',
        type: 'TEXT',
        binding: { namespace: 'GUARDIAN', path: 'full_name' },
        config: {
          validation: { maxLength: 200 },
          logic: {
            predicates: [
              {
                effect: 'visible',
                when: { eq: { marital_status: 'MARRIED' } },
              },
              {
                effect: 'required',
                when: { eq: { marital_status: 'MARRIED' } },
              },
            ] satisfies Predicate[],
          },
        },
      },
      {
        code: 'spouse_national_id',
        label: 'Spouse national ID',
        type: 'TEXT',
        binding: { namespace: 'GUARDIAN', path: 'national_id' },
        config: {
          validation: { maxLength: 50 },
          logic: {
            predicates: [
              {
                effect: 'visible',
                when: { eq: { marital_status: 'MARRIED' } },
              },
              {
                effect: 'required',
                when: { eq: { marital_status: 'MARRIED' } },
              },
            ] satisfies Predicate[],
          },
        },
      },
      {
        code: 'spouse_phone_number',
        label: 'Spouse phone number',
        type: 'TEXT',
        binding: { namespace: 'GUARDIAN', path: 'phone_number' },
        config: {
          validation: { maxLength: 30 },
          logic: {
            predicates: [
              {
                effect: 'visible',
                when: { eq: { marital_status: 'MARRIED' } },
              },
            ] satisfies Predicate[],
          },
        },
      },
    ],
  },
  {
    code: 'clinical_info',
    name: 'Clinical info',
    visibleWhen: { eq: { visitor_type: 'PATIENT' } },
    exclusivityKey: {
      field: 'visitor_type',
      thisValue: 'PATIENT',
      otherValues: ['MEDICAL_REP'],
    },
    fields: [
      {
        code: 'chief_complaint_categories',
        label: 'Chief complaint',
        type: 'MULTISELECT',
        binding: {
          namespace: 'INTAKE',
          path: 'chief_complaint_meta.categories',
        },
        config: {
          validation: {
            options: [
              { code: 'PELVIC_PAIN', label: 'Pelvic pain' },
              { code: 'ABNORMAL_BLEEDING', label: 'Abnormal bleeding' },
              { code: 'MENSTRUAL_IRREGULARITY', label: 'Menstrual irregularity' },
              { code: 'VAGINAL_DISCHARGE', label: 'Vaginal discharge' },
              { code: 'INFERTILITY', label: 'Infertility concern' },
              { code: 'PREGNANCY_FOLLOWUP', label: 'Pregnancy follow-up' },
              { code: 'CONTRACEPTION', label: 'Contraception counselling' },
              { code: 'POSTPARTUM_CHECK', label: 'Postpartum check' },
              { code: 'OTHER', label: 'Other' },
            ],
          },
        },
      },
      {
        code: 'severity',
        label: 'Severity',
        type: 'SELECT',
        binding: {
          namespace: 'INTAKE',
          path: 'chief_complaint_meta.severity',
        },
        config: {
          validation: {
            options: [
              { code: 'mild', label: 'Mild' },
              { code: 'moderate', label: 'Moderate' },
              { code: 'severe', label: 'Severe' },
            ],
          },
        },
      },
      {
        code: 'duration',
        label: 'Duration',
        type: 'TEXT',
        binding: {
          namespace: 'INTAKE',
          path: 'chief_complaint_meta.duration',
        },
        config: { validation: { maxLength: 256 } },
      },
      {
        code: 'onset',
        label: 'Onset',
        type: 'TEXT',
        binding: { namespace: 'INTAKE', path: 'chief_complaint_meta.onset' },
        config: { validation: { maxLength: 256 } },
      },
      {
        code: 'chief_complaint_notes',
        label: 'Notes',
        type: 'TEXTAREA',
        binding: { namespace: 'INTAKE', path: 'chief_complaint' },
        config: { validation: { maxLength: 5000 } },
      },
    ],
  },
  {
    code: 'vitals',
    name: 'Vitals',
    visibleWhen: { eq: { visitor_type: 'PATIENT' } },
    exclusivityKey: {
      field: 'visitor_type',
      thisValue: 'PATIENT',
      otherValues: ['MEDICAL_REP'],
    },
    fields: [
      {
        code: 'systolic_bp',
        label: 'Systolic BP',
        type: 'NUMBER',
        binding: { namespace: 'INTAKE', path: 'vitals.systolic_bp' },
        config: { validation: { min: 40, max: 300 } },
      },
      {
        code: 'diastolic_bp',
        label: 'Diastolic BP',
        type: 'NUMBER',
        binding: { namespace: 'INTAKE', path: 'vitals.diastolic_bp' },
        config: { validation: { min: 30, max: 200 } },
      },
      {
        code: 'pulse',
        label: 'Pulse',
        type: 'NUMBER',
        binding: { namespace: 'INTAKE', path: 'vitals.pulse' },
        config: { validation: { min: 20, max: 250 } },
      },
      {
        code: 'temperature_c',
        label: 'Temperature (°C)',
        type: 'DECIMAL',
        binding: { namespace: 'INTAKE', path: 'vitals.temperature_c' },
        config: { validation: { min: 25, max: 45 } },
      },
      {
        code: 'weight_kg',
        label: 'Weight (kg)',
        type: 'DECIMAL',
        binding: { namespace: 'INTAKE', path: 'vitals.weight_kg' },
      },
      {
        code: 'height_cm',
        label: 'Height (cm)',
        type: 'DECIMAL',
        binding: { namespace: 'INTAKE', path: 'vitals.height_cm' },
      },
      {
        code: 'bmi',
        label: 'BMI',
        type: 'COMPUTED',
        binding: { namespace: 'COMPUTED', path: 'vitals.bmi' },
        config: {
          ui: { derivedFrom: ['weight_kg', 'height_cm'] },
          logic: { formula: 'weight_kg / ((height_cm / 100) ^ 2)' },
        },
      },
    ],
  },
  {
    code: 'medical_rep_info',
    name: 'Medical rep info',
    visibleWhen: { eq: { visitor_type: 'MEDICAL_REP' } },
    exclusivityKey: {
      field: 'visitor_type',
      thisValue: 'MEDICAL_REP',
      otherValues: ['PATIENT'],
    },
    fields: [
      {
        code: 'rep_full_name',
        label: 'Rep full name',
        type: 'TEXT',
        binding: { namespace: 'MEDICAL_REP', path: 'full_name' },
        config: { validation: { maxLength: 200 } },
      },
      {
        code: 'rep_national_id',
        label: 'Rep national ID',
        type: 'TEXT',
        binding: { namespace: 'MEDICAL_REP', path: 'national_id' },
        config: { validation: { maxLength: 50 } },
      },
      {
        code: 'rep_phone_number',
        label: 'Rep phone number',
        type: 'TEXT',
        binding: { namespace: 'MEDICAL_REP', path: 'phone_number' },
        config: { validation: { maxLength: 30 } },
      },
      {
        code: 'rep_email',
        label: 'Rep email',
        type: 'TEXT',
        binding: { namespace: 'MEDICAL_REP', path: 'email' },
        config: { validation: { maxLength: 200 } },
      },
      {
        code: 'company_name',
        label: 'Company',
        type: 'TEXT',
        binding: { namespace: 'MEDICAL_REP', path: 'company_name' },
        config: { validation: { maxLength: 200 } },
      },
      {
        code: 'medication_ids',
        label: 'Medications discussed',
        type: 'MULTISELECT',
        binding: { namespace: 'MEDICAL_REP', path: 'medication_ids' },
        config: {
          ui: { optionsSource: '/v1/medications?search=' },
        },
      },
      {
        code: 'rep_notes',
        label: 'Discussion notes',
        type: 'TEXTAREA',
        binding: { namespace: 'MEDICAL_REP', path: 'notes' },
        config: { validation: { maxLength: 2000 } },
      },
    ],
  },
];

/**
 * Pushes a `forbidden when other discriminator value` predicate onto each
 * field in a section whose `exclusivityKey` is set. Server enforces the rule
 * symmetrically — if the discriminator says PATIENT, any MEDICAL_REP-namespace
 * field is rejected.
 */
function emitAutoForbiddenPredicates(): void {
  for (const section of SECTIONS) {
    if (!section.exclusivityKey) continue;
    const { field, otherValues } = section.exclusivityKey;
    for (const f of section.fields) {
      const cfg = (f.config ??= {});
      const logic = (cfg.logic ??= {});
      const preds: Predicate[] = (logic.predicates ??= []);
      for (const otherValue of otherValues) {
        preds.push({
          effect: 'forbidden',
          when: { eq: { [field]: otherValue } },
          message: `${f.code} is not allowed when ${field} is ${otherValue}`,
        });
      }
    }
  }
}

/**
 * Validates each section/field config and binding before any DB write — any
 * typo, unknown namespace path, or invalid config shape throws here, so the
 * seed fails fast and nothing partial lands in the database.
 */
function assertAllValid(): void {
  for (const section of SECTIONS) {
    assertValidConfig(
      buildSectionConfig(section),
      `section "${section.code}"`,
    );
    for (const field of section.fields) {
      const cfg = field.config ?? {};
      assertValidConfig(cfg, `field "${section.code}.${field.code}"`);
      const descriptor = FIELD_TYPES[field.type];
      if (field.binding?.namespace) {
        if (!descriptor.allowedNamespaces.has(field.binding.namespace as any)) {
          throw new Error(
            `Field "${section.code}.${field.code}": type ${field.type} does not allow namespace ${field.binding.namespace}`,
          );
        }
        validateBinding(field.binding.namespace as any, field.binding.path);
      }
      descriptor.assertConfig?.(cfg, `field "${section.code}.${field.code}"`);
    }
  }
}

function buildSectionConfig(section: SectionSpec): any {
  const config: any = { ui: {}, validation: {}, logic: {} };
  if (section.visibleWhen) {
    config.logic.predicates = [
      { effect: 'visible', when: section.visibleWhen },
    ] satisfies Predicate[];
  }
  return config;
}

export async function seedObgynBookVisitTemplate(prisma: PrismaClient) {
  emitAutoForbiddenPredicates();
  assertAllValid();

  const gynSpecialty = await prisma.specialty.findUnique({
    where: { code: 'GYN' },
  });

  // Upsert the template row (DRAFT initially; activation flip below).
  const template = await prisma.formTemplate.upsert({
    where: {
      code_version: { code: TEMPLATE_CODE, version: TEMPLATE_VERSION },
    },
    update: {
      name: 'OB/GYN Book Visit',
      description:
        'Front-desk booking form for OB/GYN visits — handles both patient and medical-rep flows via the visitor_type discriminator.',
      scope: 'BOOK_VISIT',
      specialty_id: gynSpecialty?.id ?? null,
    },
    create: {
      code: TEMPLATE_CODE,
      version: TEMPLATE_VERSION,
      name: 'OB/GYN Book Visit',
      description:
        'Front-desk booking form for OB/GYN visits — handles both patient and medical-rep flows via the visitor_type discriminator.',
      scope: 'BOOK_VISIT',
      status: 'DRAFT',
      specialty_id: gynSpecialty?.id ?? null,
    },
  });

  // Upsert sections + fields.
  for (let i = 0; i < SECTIONS.length; i++) {
    const sectionSpec = SECTIONS[i];
    const section = await prisma.formSection.upsert({
      where: {
        form_template_id_code: {
          form_template_id: template.id,
          code: sectionSpec.code,
        },
      },
      update: {
        name: sectionSpec.name,
        order: i,
        config: buildSectionConfig(sectionSpec),
      },
      create: {
        form_template_id: template.id,
        code: sectionSpec.code,
        name: sectionSpec.name,
        order: i,
        config: buildSectionConfig(sectionSpec),
      },
    });

    for (let j = 0; j < sectionSpec.fields.length; j++) {
      const fieldSpec = sectionSpec.fields[j];
      const cfg = fieldSpec.config ?? { ui: {}, validation: {}, logic: {} };
      await prisma.formField.upsert({
        where: {
          section_id_code: {
            section_id: section.id,
            code: fieldSpec.code,
          },
        },
        update: {
          label: fieldSpec.label,
          type: fieldSpec.type,
          order: j,
          required: fieldSpec.required ?? false,
          binding_namespace: (fieldSpec.binding?.namespace ?? null) as any,
          binding_path: fieldSpec.binding?.path ?? null,
          config: cfg,
        },
        create: {
          section_id: section.id,
          code: fieldSpec.code,
          label: fieldSpec.label,
          type: fieldSpec.type,
          order: j,
          required: fieldSpec.required ?? false,
          binding_namespace: (fieldSpec.binding?.namespace ?? null) as any,
          binding_path: fieldSpec.binding?.path ?? null,
          config: cfg,
        },
      });
    }
  }

  // Activation transaction: ensure exactly one active version per code.
  await prisma.$transaction([
    prisma.formTemplate.updateMany({
      where: {
        code: TEMPLATE_CODE,
        is_active: true,
        id: { not: template.id },
      },
      data: { is_active: false },
    }),
    prisma.formTemplate.update({
      where: { id: template.id },
      data: {
        is_active: true,
        activated_at: template.is_active ? template.activated_at : new Date(),
        status: 'PUBLISHED',
        published_at: template.published_at ?? new Date(),
      },
    }),
  ]);

  console.log(`Seeded form template "${TEMPLATE_CODE}" v${TEMPLATE_VERSION} (active).`);
}
