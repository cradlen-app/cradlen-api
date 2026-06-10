/**
 * Book-Visit shell template seed.
 *
 * Generic booking shell — handles the visitor_type (PATIENT / MEDICAL_REP)
 * discriminator AND a specialty_code SYSTEM-bound discriminator that selects
 * which extension contributes specialty-specific clinical fields.
 *
 * Returns the upserted shell row (NOT activated here — activation is bundled
 * by the orchestrator seed in `book-visit.ts`).
 */

import { FormTemplate, PrismaClient } from '@prisma/client';
import { validateBinding } from '../../src/builder/fields/allowed-paths.js';
import { assertValidConfig } from '../../src/builder/fields/field-config.schema.js';
import { FIELD_TYPES } from '../../src/builder/fields/field-type.registry.js';
import type { Predicate } from '../../src/builder/rules/predicates.js';

const TEMPLATE_CODE = 'book_visit';
const TEMPLATE_VERSION = 17;

interface FieldSpec {
  code: string;
  label: string;
  type: keyof typeof FIELD_TYPES;
  required?: boolean;
  binding?: { namespace: string; path: string | null };
  config?: { ui?: any; validation?: any; logic?: any; i18n?: any };
}

interface SectionSpec {
  code: string;
  name: string;
  /** Per-locale section-name overrides, e.g. `{ ar: { name: '…' } }`. */
  i18n?: Record<string, { name?: string }>;
  visibleWhen?: { eq: Record<string, unknown> };
  exclusivityKey?: { field: string; thisValue: string; otherValues: string[] };
  fields: FieldSpec[];
}

const SECTIONS: SectionSpec[] = [
  {
    code: 'visit_metadata',
    name: 'Visit metadata',
    i18n: { ar: { name: 'بيانات الزيارة' } },
    fields: [
      {
        code: 'visitor_type',
        label: 'Visitor type',
        type: 'SELECT',
        required: true,
        binding: { namespace: 'SYSTEM', path: 'visitor_type' },
        config: {
          i18n: {
            ar: {
              label: 'نوع الزائر',
              options: { PATIENT: 'مريض', MEDICAL_REP: 'مندوب دعاية' },
            },
          },
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
        code: 'specialty_code',
        label: 'Specialty',
        type: 'SELECT',
        binding: { namespace: 'SYSTEM', path: 'specialty_code' },
        config: {
          i18n: { ar: { label: 'التخصص' } },
          ui: {
            optionsSource: '/v1/organizations/{org_id}/specialties',
            default: { kind: 'first_option' },
            prefillFrom: 'specialty_code',
          },
          logic: {
            is_discriminator: true,
            predicates: [
              { effect: 'visible', when: { eq: { visitor_type: 'PATIENT' } } },
              { effect: 'required', when: { eq: { visitor_type: 'PATIENT' } } },
            ] satisfies Predicate[],
          },
        },
      },
      {
        code: 'care_path_code',
        label: 'Care path',
        type: 'SELECT',
        binding: { namespace: 'VISIT', path: 'care_path_code' },
        config: {
          i18n: { ar: { label: 'المسار العلاجي' } },
          ui: {
            optionsSource: '/v1/care-paths?specialtyCode={specialty_code}',
            default: { kind: 'first_option' },
          },
          logic: {
            // Not flagged is_discriminator: the discriminator-reset hook only
            // watches systemValues. A VISIT-bound discriminator would be wiped
            // by its own reset and loop. When a downstream section needs to
            // gate on care_path_code, use a regular `when` predicate.
            predicates: [
              { effect: 'visible', when: { eq: { visitor_type: 'PATIENT' } } },
            ] satisfies Predicate[],
          },
        },
      },
      {
        code: 'scheduled_at_patient',
        label: 'Scheduled at',
        type: 'DATETIME',
        binding: { namespace: 'VISIT', path: 'scheduled_at' },
        config: {
          i18n: { ar: { label: 'موعد الزيارة' } },
          ui: { default: { kind: 'now' } },
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
          i18n: { ar: { label: 'موعد الزيارة' } },
          ui: { default: { kind: 'now' } },
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
          i18n: {
            ar: {
              label: 'الأولوية',
              options: { NORMAL: 'عادية', EMERGENCY: 'طارئة' },
            },
          },
          ui: { default: 'NORMAL' },
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
        code: 'service_id',
        label: 'Service',
        type: 'SELECT',
        // VISIT-bound (like care_path_code): consumed at booking to capture the
        // charge, not persisted on the visit row. SYSTEM-bound non-discriminator
        // fields are dropped by the frontend submission builder.
        binding: { namespace: 'VISIT', path: 'service_id' },
        config: {
          i18n: { ar: { label: 'الخدمة' } },
          ui: {
            // Catalog services the org offers. The picked service id is billed
            // at booking (the assigned doctor must be authorized for it) and
            // narrows the doctor picker below to authorized providers.
            optionsSource:
              '/v1/organizations/{org_id}/financial/catalog/services?active=true',
          },
          logic: {
            // Optional: bookings still work before catalog/pricing is set up.
            predicates: [
              { effect: 'visible', when: { eq: { visitor_type: 'PATIENT' } } },
            ] satisfies Predicate[],
          },
        },
      },
      {
        code: 'assigned_doctor_patient',
        label: 'Assigned doctor',
        type: 'SELECT',
        binding: { namespace: 'VISIT', path: 'assigned_doctor_id' },
        config: {
          i18n: { ar: { label: 'الطبيب المعالج' } },
          ui: {
            // `{service_id?}` is optional: when no billable service is chosen the
            // param is empty and the endpoint returns all specialty doctors; once
            // a service is picked the list narrows to providers authorized for it.
            optionsSource:
              '/v1/organizations/{org_id}/branches/{branch_id}/staff?doctors_only=true&specialty_code={specialty_code}&authorized_for_service={service_id?}',
            default: { kind: 'first_option' },
            prefillFrom: 'assigned_doctor_id',
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
        code: 'assigned_doctor_rep',
        label: 'Assigned doctor',
        type: 'SELECT',
        binding: { namespace: 'MEDICAL_REP', path: 'assigned_doctor_id' },
        config: {
          i18n: { ar: { label: 'الطبيب المعالج' } },
          ui: {
            optionsSource:
              '/v1/organizations/{org_id}/branches/{branch_id}/staff?doctors_only=true',
            default: { kind: 'first_option' },
          },
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
        code: 'appointment_type',
        label: 'Appointment type',
        type: 'SELECT',
        binding: { namespace: 'VISIT', path: 'appointment_type' },
        config: {
          i18n: {
            ar: {
              label: 'نوع الموعد',
              options: { VISIT: 'زيارة', FOLLOW_UP: 'متابعة' },
            },
          },
          ui: { default: 'VISIT' },
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
    i18n: { ar: { name: 'بيانات المريض' } },
    visibleWhen: { eq: { visitor_type: 'PATIENT' } },
    exclusivityKey: {
      field: 'visitor_type',
      thisValue: 'PATIENT',
      otherValues: ['MEDICAL_REP'],
    },
    fields: [
      {
        code: 'patient_id',
        label: 'Patient (resolved id)',
        type: 'ENTITY_SEARCH',
        binding: { namespace: 'LOOKUP', path: 'patient_id' },
        config: {
          ui: { hidden: true },
          logic: { entity: 'patient' },
        },
      },
      {
        code: 'full_name',
        label: 'Full name',
        type: 'TEXT',
        binding: { namespace: 'PATIENT', path: 'full_name' },
        config: {
          i18n: {
            ar: {
              label: 'الاسم الكامل',
              placeholder: 'ابحث عن مريض موجود أو اكتب اسماً جديداً',
            },
          },
          ui: {
            placeholder: 'Search existing patient or type a new name',
            searchEntity: {
              kind: 'patient',
              idTarget: 'patient_id',
              allowCreate: true,
              fillFields: {
                national_id: 'national_id',
                phone_number: 'phone_number',
                date_of_birth: 'date_of_birth',
                address: 'address',
                marital_status: 'marital_status',
                care_path_code: 'active_care_path_code',
              },
            },
          },
          validation: { minLength: 2, maxLength: 200 },
        },
      },
      {
        code: 'national_id',
        label: 'National ID',
        type: 'TEXT',
        binding: { namespace: 'PATIENT', path: 'national_id' },
        // Digits only, 8–20 long. Tolerant across countries (Egyptian 14,
        // Saudi 10, passports/iqama, …) — the pattern enforces digits + range.
        config: {
          i18n: { ar: { label: 'الرقم القومي' } },
          validation: {
            minLength: 8,
            maxLength: 20,
            pattern: '^[0-9]{8,20}$',
          },
        },
      },
      {
        code: 'date_of_birth',
        label: 'Date of birth',
        type: 'DATE',
        binding: { namespace: 'PATIENT', path: 'date_of_birth' },
        // Must be a real past date within a human lifespan.
        config: {
          i18n: { ar: { label: 'تاريخ الميلاد' } },
          validation: { notInFuture: true, maxAgeYears: 120 },
        },
      },
      {
        code: 'phone_number',
        label: 'Phone number',
        type: 'TEXT',
        binding: { namespace: 'PATIENT', path: 'phone_number' },
        // Lenient international: optional leading +, digits with spaces/dashes,
        // 7–20 chars total.
        config: {
          i18n: { ar: { label: 'رقم الهاتف' } },
          validation: {
            minLength: 7,
            maxLength: 20,
            pattern: '^\\+?[0-9\\s\\-]{7,20}$',
          },
        },
      },
      {
        code: 'address',
        label: 'Address',
        type: 'TEXT',
        binding: { namespace: 'PATIENT', path: 'address' },
        config: {
          i18n: { ar: { label: 'العنوان' } },
          validation: { maxLength: 200 },
        },
      },
      {
        code: 'marital_status',
        label: 'Marital status',
        type: 'SELECT',
        binding: { namespace: 'PATIENT', path: 'marital_status' },
        config: {
          i18n: {
            ar: {
              label: 'الحالة الاجتماعية',
              options: {
                SINGLE: 'أعزب/عزباء',
                MARRIED: 'متزوج/ة',
                DIVORCED: 'مطلّق/ة',
                WIDOWED: 'أرمل/ة',
                SEPARATED: 'منفصل/ة',
                ENGAGED: 'مخطوب/ة',
                UNKNOWN: 'غير محدد',
              },
            },
          },
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
    ],
  },
  {
    code: 'medical_rep_info',
    name: 'Medical rep info',
    i18n: { ar: { name: 'بيانات مندوب الدعاية' } },
    visibleWhen: { eq: { visitor_type: 'MEDICAL_REP' } },
    exclusivityKey: {
      field: 'visitor_type',
      thisValue: 'MEDICAL_REP',
      otherValues: ['PATIENT'],
    },
    fields: [
      {
        code: 'medical_rep_id',
        label: 'Medical rep (resolved id)',
        type: 'ENTITY_SEARCH',
        binding: { namespace: 'LOOKUP', path: 'medical_rep_id' },
        config: {
          ui: { hidden: true },
          logic: { entity: 'medical_rep' },
        },
      },
      {
        code: 'rep_full_name',
        label: 'Rep full name',
        type: 'TEXT',
        binding: { namespace: 'MEDICAL_REP', path: 'rep_full_name' },
        config: {
          i18n: {
            ar: {
              label: 'اسم المندوب',
              placeholder: 'ابحث عن مندوب موجود أو اكتب اسماً جديداً',
            },
          },
          ui: {
            placeholder: 'Search existing rep or type a new name',
            searchEntity: {
              kind: 'medical_rep',
              idTarget: 'medical_rep_id',
              allowCreate: true,
              fillFields: {
                rep_phone_number: 'phone_number',
                company_name: 'company_name',
                specialty_focus: 'specialty_focus',
              },
            },
          },
          validation: { maxLength: 200 },
        },
      },
      {
        code: 'rep_phone_number',
        label: 'Rep phone number',
        type: 'TEXT',
        binding: { namespace: 'MEDICAL_REP', path: 'rep_phone_number' },
        config: {
          i18n: { ar: { label: 'هاتف المندوب' } },
          validation: { maxLength: 30 },
        },
      },
      {
        code: 'company_name',
        label: 'Company',
        type: 'TEXT',
        binding: { namespace: 'MEDICAL_REP', path: 'company_name' },
        config: {
          i18n: { ar: { label: 'الشركة' } },
          ui: { autocompleteEndpoint: '/v1/medical-reps/companies' },
          validation: { maxLength: 200 },
        },
      },
      {
        code: 'specialty_focus',
        label: 'Specialty focus',
        type: 'SELECT',
        binding: { namespace: 'MEDICAL_REP', path: 'specialty_focus' },
        config: {
          i18n: { ar: { label: 'التخصص المستهدف' } },
          ui: { optionsSource: '/v1/organizations/{org_id}/specialties' },
        },
      },
    ],
  },
];

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
  if (section.i18n) config.i18n = section.i18n;
  return config;
}

export async function seedBookVisitShell(
  prisma: PrismaClient,
): Promise<FormTemplate> {
  emitAutoForbiddenPredicates();
  assertAllValid();

  const template = await prisma.formTemplate.upsert({
    where: {
      code_version: { code: TEMPLATE_CODE, version: TEMPLATE_VERSION },
    },
    update: {
      name: 'Book Visit (shell)',
      description:
        'Generic booking shell — handles visitor_type (PATIENT / MEDICAL_REP) and the specialty_code discriminator that selects which extension provides specialty-specific clinical fields.',
      scope: 'BOOK_VISIT',
      specialty_id: null,
      parent_template_id: null,
      extension_key: null,
    },
    create: {
      code: TEMPLATE_CODE,
      version: TEMPLATE_VERSION,
      name: 'Book Visit (shell)',
      description:
        'Generic booking shell — handles visitor_type (PATIENT / MEDICAL_REP) and the specialty_code discriminator that selects which extension provides specialty-specific clinical fields.',
      scope: 'BOOK_VISIT',
      status: 'DRAFT',
      specialty_id: null,
      parent_template_id: null,
      extension_key: null,
    },
  });

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

  return template;
}
