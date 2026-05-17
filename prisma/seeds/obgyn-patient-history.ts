/**
 * OB/GYN Patient-History template seed.
 *
 * Standalone form template (code='obgyn_patient_history') that drives the
 * patient-level OB/GYN history UI. Bindings target the unified bulk
 * `PATCH /patients/:id/obgyn-history` endpoint, which fans the payload
 * across the singleton `PatientObgynHistory` JSON columns and the five
 * repeatable child collections (pregnancies, contraceptives, non-gyn
 * surgeries, medications, allergies) inside one transaction.
 *
 * Section conventions:
 *  - `is_repeatable=true` sections describe ONE row; their `code` matches
 *    the body array key on the unified PATCH DTO (and the granular
 *    read-only GET resource slug).
 *  - The eye-icon "notes" affordance per section maps to PatientHistoryNote
 *    keyed on `section_code = section.code` via the standalone notes
 *    endpoints. The template itself carries no notes field.
 *  - Multi-selects that contain a 'NONE' option auto-emit `forbidden`
 *    predicates so 'NONE' can't co-exist with any other choice.
 *  - "Other"-revealing free-text fields auto-emit a `required` predicate
 *    keyed on the parent multi-select including 'OTHER'.
 *
 * Activation: ends with a $transaction that deactivates prior active rows
 * for code='obgyn_patient_history' and flips this one to active +
 * PUBLISHED. Idempotent (upsert by (code, version)).
 */

import { BindingNamespace, PrismaClient } from '@prisma/client';
import { validateBinding } from '../../src/builder/fields/allowed-paths.js';
import { assertValidConfig } from '../../src/builder/fields/field-config.schema.js';
import { FIELD_TYPES } from '../../src/builder/fields/field-type.registry.js';
import type { Predicate } from '../../src/builder/rules/predicates.js';

const TEMPLATE_CODE = 'obgyn_patient_history';
const TEMPLATE_VERSION = 1;

type FieldType = keyof typeof FIELD_TYPES;
type SectionConfig = { ui?: any; validation?: any; logic?: any };

interface FieldSpec {
  code: string;
  label: string;
  type: FieldType;
  required?: boolean;
  binding?: { namespace: BindingNamespace; path: string | null };
  config?: SectionConfig;
}

interface SectionSpec {
  code: string;
  name: string;
  is_repeatable?: boolean;
  fields: FieldSpec[];
}

const opt = (code: string, label: string) => ({ code, label });

const SECTIONS: SectionSpec[] = [
  {
    code: 'menstrual_history',
    name: 'Menstrual History',
    fields: [
      {
        code: 'age_at_menarche',
        label: 'Age at menarche',
        type: 'NUMBER',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'gynecological_baseline.age_at_menarche',
        },
        config: { validation: { min: 5, max: 25 } },
      },
      {
        code: 'cycle_regularity',
        label: 'Cycle regularity',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'gynecological_baseline.cycle_regularity',
        },
        config: {
          validation: {
            options: [opt('REGULAR', 'Regular'), opt('IRREGULAR', 'Irregular')],
          },
        },
      },
      {
        code: 'duration',
        label: 'Duration',
        type: 'TEXT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'gynecological_baseline.duration',
        },
      },
      {
        code: 'flow',
        label: 'Flow',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'gynecological_baseline.flow',
        },
        config: {
          validation: {
            options: [
              opt('LIGHT', 'Light'),
              opt('MODERATE', 'Moderate'),
              opt('HEAVY', 'Heavy'),
            ],
          },
        },
      },
      {
        code: 'dysmenorrhea',
        label: 'Dysmenorrhea',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'gynecological_baseline.dysmenorrhea',
        },
        config: {
          validation: {
            options: [
              opt('NONE', 'None'),
              opt('MILD', 'Mild'),
              opt('MODERATE', 'Moderate'),
              opt('SEVERE', 'Severe'),
            ],
          },
        },
      },
    ],
  },
  {
    code: 'gynecologic_procedures',
    name: 'Past Gynecologic Procedures / Surgeries',
    fields: [
      {
        code: 'items',
        label: 'Procedures',
        type: 'MULTISELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'gynecologic_procedures.items',
        },
        config: {
          validation: {
            options: [
              opt('NONE', 'None'),
              opt('CYSTECTOMY', 'Cystectomy'),
              opt('HYSTEROSCOPY', 'Hysteroscopy'),
              opt('D_AND_C', 'D&C'),
              opt('LAPAROSCOPY', 'Laparoscopy'),
              opt('OTHER', 'Other'),
            ],
          },
        },
      },
      {
        code: 'notes',
        label: 'Other / notes',
        type: 'TEXTAREA',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'gynecologic_procedures.notes',
        },
        config: {
          logic: {
            predicates: [
              {
                effect: 'required',
                when: { in: { 'gynecologic_procedures.items': ['OTHER'] } },
                message:
                  'Describe the procedure when "Other" is selected above.',
              },
            ] satisfies Predicate[],
          },
        },
      },
    ],
  },
  {
    code: 'contraceptives',
    name: 'Contraceptive History',
    is_repeatable: true,
    fields: [
      {
        code: 'method',
        label: 'Method',
        type: 'SELECT',
        required: true,
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'contraceptives.method',
        },
        config: {
          validation: {
            options: [
              opt('COMBINED_OCP', 'Combined OCP'),
              opt('POP', 'Progestin-only pill'),
              opt('IUD_COPPER', 'IUD (Copper)'),
              opt('IUD_HORMONAL', 'IUD (Hormonal)'),
              opt('IMPLANT', 'Implant'),
              opt('INJECTABLE', 'Injectable'),
              opt('CONDOM', 'Condom'),
              opt('STERILIZATION', 'Sterilization'),
              opt('NATURAL', 'Natural / withdrawal'),
              opt('OTHER', 'Other'),
            ],
          },
        },
      },
      {
        code: 'duration',
        label: 'Duration',
        type: 'TEXT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'contraceptives.duration',
        },
      },
      {
        code: 'complications',
        label: 'Complications',
        type: 'TEXT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'contraceptives.complications',
        },
      },
    ],
  },
  {
    code: 'screening_vaccinations',
    name: 'Screening & Vaccinations',
    fields: [
      {
        code: 'pap_smear',
        label: 'Pap smear / HPV',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'screening_history.pap_smear',
        },
        config: {
          validation: {
            options: [
              opt('UP_TO_DATE', 'Up-to-date'),
              opt('OVERDUE', 'Overdue'),
              opt('NEVER', 'Never'),
            ],
          },
        },
      },
      {
        code: 'pap_smear_date',
        label: 'Pap smear / HPV date',
        type: 'DATE',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'screening_history.pap_smear_date',
        },
      },
      {
        code: 'mammography',
        label: 'Mammography',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'screening_history.mammography',
        },
        config: {
          validation: {
            options: [opt('YES', 'Yes'), opt('NO', 'No')],
          },
        },
      },
      {
        code: 'mammography_date',
        label: 'Mammography date',
        type: 'DATE',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'screening_history.mammography_date',
        },
      },
      {
        code: 'vaccines',
        label: 'Vaccines',
        type: 'MULTISELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'screening_history.vaccines',
        },
        config: {
          validation: {
            options: [
              opt('HPV', 'HPV'),
              opt('HEP_B', 'Hep B'),
              opt('OTHER', 'Other'),
            ],
          },
        },
      },
    ],
  },
  {
    code: 'obstetric_summary',
    name: 'Obstetric History',
    fields: [
      {
        code: 'gravida',
        label: 'Gravida',
        type: 'NUMBER',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'obstetric_summary.gravida',
        },
        config: { validation: { min: 0 } },
      },
      {
        code: 'para',
        label: 'Para',
        type: 'NUMBER',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'obstetric_summary.para',
        },
        config: { validation: { min: 0 } },
      },
      {
        code: 'abortion',
        label: 'Abortion',
        type: 'NUMBER',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'obstetric_summary.abortion',
        },
        config: { validation: { min: 0 } },
      },
      {
        code: 'ectopic',
        label: 'Ectopic',
        type: 'NUMBER',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'obstetric_summary.ectopic',
        },
        config: { validation: { min: 0 } },
      },
      {
        code: 'stillbirths',
        label: 'Stillbirths',
        type: 'NUMBER',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'obstetric_summary.stillbirths',
        },
        config: { validation: { min: 0 } },
      },
    ],
  },
  {
    code: 'pregnancies',
    name: 'Previous Pregnancy Details',
    is_repeatable: true,
    fields: [
      {
        code: 'birth_date',
        label: 'Birth date',
        type: 'DATE',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'pregnancies.birth_date',
        },
      },
      {
        code: 'outcome',
        label: 'Outcome',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'pregnancies.outcome',
        },
        config: {
          validation: {
            options: [
              opt('LIVE_BIRTH', 'Live birth'),
              opt('STILLBIRTH', 'Stillbirth'),
              opt('MISCARRIAGE', 'Miscarriage'),
              opt('ABORTION', 'Abortion'),
              opt('ECTOPIC', 'Ectopic'),
              opt('ONGOING', 'Ongoing'),
            ],
          },
        },
      },
      {
        code: 'mode_of_delivery',
        label: 'Mode of delivery',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'pregnancies.mode_of_delivery',
        },
        config: {
          validation: {
            options: [
              opt('VAGINAL', 'Vaginal'),
              opt('CESAREAN', 'Cesarean'),
              opt('ASSISTED_VAGINAL', 'Assisted vaginal'),
              opt('OTHER', 'Other'),
            ],
          },
        },
      },
      {
        code: 'gestational_age_weeks',
        label: 'Gestational age at delivery (weeks)',
        type: 'NUMBER',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'pregnancies.gestational_age_weeks',
        },
        config: { validation: { min: 0, max: 45 } },
      },
      {
        code: 'neonatal_outcome',
        label: 'Neonatal outcome',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'pregnancies.neonatal_outcome',
        },
        config: {
          validation: {
            options: [
              opt('LIVE_BIRTH', 'Live birth'),
              opt('NICU', 'NICU admission'),
              opt('NEONATAL_DEATH', 'Neonatal death'),
              opt('STILLBIRTH', 'Stillbirth'),
              opt('OTHER', 'Other'),
            ],
          },
        },
      },
    ],
  },
  {
    code: 'medical_chronic_illnesses',
    name: 'Chronic Illnesses',
    fields: [
      {
        code: 'items',
        label: 'Chronic illnesses',
        type: 'MULTISELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'medical_chronic_illnesses.items',
        },
        config: {
          validation: {
            options: [
              opt('NONE', 'None'),
              opt('HTN', 'HTN'),
              opt('DM', 'DM'),
              opt('THYROID', 'Thyroid'),
              opt('ASTHMA', 'Asthma'),
              opt('OTHER', 'Other'),
            ],
          },
        },
      },
      {
        code: 'notes',
        label: 'Other / notes',
        type: 'TEXTAREA',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'medical_chronic_illnesses.notes',
        },
        config: {
          logic: {
            predicates: [
              {
                effect: 'required',
                when: {
                  in: { 'medical_chronic_illnesses.items': ['OTHER'] },
                },
                message:
                  'Describe the illness when "Other" is selected above.',
              },
            ] satisfies Predicate[],
          },
        },
      },
    ],
  },
  {
    code: 'non_gyn_surgeries',
    name: 'Previous Surgeries (Non-gynecologic)',
    is_repeatable: true,
    fields: [
      {
        code: 'surgery_name',
        label: 'Surgery name',
        type: 'TEXT',
        required: true,
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'non_gyn_surgeries.surgery_name',
        },
      },
      {
        code: 'surgery_date',
        label: 'Date',
        type: 'DATE',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'non_gyn_surgeries.surgery_date',
        },
      },
    ],
  },
  {
    code: 'allergies',
    name: 'Allergies',
    is_repeatable: true,
    fields: [
      {
        code: 'allergy_to',
        label: 'Allergy to',
        type: 'TEXT',
        required: true,
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'allergies.allergy_to',
        },
      },
      {
        code: 'associated_symptoms',
        label: 'Associated symptoms',
        type: 'TEXT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'allergies.associated_symptoms',
        },
      },
    ],
  },
  {
    code: 'medications',
    name: 'Medications (current / past, long-term)',
    is_repeatable: true,
    fields: [
      {
        code: 'drug_name',
        label: 'Drug name',
        type: 'ENTITY_SEARCH',
        required: true,
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'medications.drug_name',
        },
        config: {
          ui: {
            searchEntity: {
              kind: 'medication',
              idTarget: 'medication_id',
              allowCreate: true,
            },
          },
          logic: { entity: 'medication' },
        },
      },
      {
        // Hidden sibling — receives the resolved medication catalog id when
        // the user picks a suggestion. The renderer hides any field that is
        // the `idTarget` of another field's `ui.searchEntity`, so this never
        // shows on the form; the submission builder writes it at the bound
        // path `medications.medication_id`.
        code: 'medication_id',
        label: 'Medication id',
        type: 'TEXT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'medications.medication_id',
        },
      },
      {
        code: 'indication',
        label: 'Indication',
        type: 'TEXT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'medications.indication',
        },
      },
      {
        code: 'from_date',
        label: 'From',
        type: 'DATE',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'medications.from_date',
        },
      },
    ],
  },
  {
    code: 'family_history',
    name: 'Family History',
    fields: [
      {
        code: 'gynecologic_cancers',
        label: 'Gynecologic cancers',
        type: 'MULTISELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'family_history.gynecologic_cancers',
        },
        config: {
          validation: {
            options: [
              opt('NONE', 'None'),
              opt('BREAST', 'Breast'),
              opt('OVARIAN', 'Ovarian'),
              opt('UTERINE', 'Uterine'),
              opt('OTHER', 'Other'),
            ],
          },
        },
      },
      {
        code: 'chronic_illnesses',
        label: 'Chronic illnesses',
        type: 'MULTISELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'family_history.chronic_illnesses',
        },
        config: {
          validation: {
            options: [
              opt('NONE', 'None'),
              opt('HTN', 'HTN'),
              opt('DM', 'DM'),
              opt('THYROID', 'Thyroid'),
              opt('CARDIAC', 'Cardiac'),
              opt('OTHER', 'Other'),
            ],
          },
        },
      },
      {
        code: 'genetic_disorders',
        label: 'Genetic disorders',
        type: 'TEXTAREA',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'family_history.genetic_disorders',
        },
      },
    ],
  },
  {
    code: 'fertility_history',
    name: 'Fertility History',
    fields: [
      {
        code: 'duration_of_infertility',
        label: 'Duration of infertility',
        type: 'TEXT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'fertility_history.duration_of_infertility',
        },
      },
      {
        code: 'partner_fertility_status',
        label: "Partner's fertility status",
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'fertility_history.partner_fertility_status',
        },
        config: {
          validation: {
            options: [
              opt('NORMAL', 'Normal'),
              opt('ABNORMAL', 'Abnormal'),
              opt('UNKNOWN', 'Unknown'),
            ],
          },
        },
      },
      {
        code: 'treatments',
        label: 'Previous fertility treatments',
        type: 'MULTISELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'fertility_history.treatments',
        },
        config: {
          validation: {
            options: [
              opt('NONE', 'None'),
              opt('CLOMID', 'Clomid'),
              opt('IUI', 'IUI'),
              opt('IVF', 'IVF'),
              opt('OTHER', 'Other'),
            ],
          },
        },
      },
      {
        code: 'menstrual_ovulation_patterns',
        label: 'Menstrual & ovulation patterns',
        type: 'TEXTAREA',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'fertility_history.menstrual_ovulation_patterns',
        },
      },
      {
        code: 'past_pregnancies_outcomes',
        label: 'Past pregnancies & outcomes',
        type: 'TEXTAREA',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'fertility_history.past_pregnancies_outcomes',
        },
      },
    ],
  },
];

/**
 * Multi-selects that include a 'NONE' option get auto-forbidden predicates
 * so 'NONE' can't co-exist with any other choice. The path used inside the
 * predicate is the field's full binding path so the predicate evaluator
 * can look it up on the unified payload.
 */
function emitNoneExclusivityPredicates(): void {
  for (const section of SECTIONS) {
    for (const f of section.fields) {
      if (f.type !== 'MULTISELECT') continue;
      const options = f.config?.validation?.options as
        | Array<{ code: string }>
        | undefined;
      if (!options?.some((o) => o.code === 'NONE')) continue;
      const path = f.binding?.path;
      if (!path) continue;
      const cfg = (f.config ??= {});
      const logic = (cfg.logic ??= {});
      const preds: Predicate[] = (logic.predicates ??= []);
      for (const o of options) {
        if (o.code === 'NONE') continue;
        preds.push({
          effect: 'forbidden',
          when: {
            and: [
              { in: { [path]: ['NONE'] } },
              { in: { [path]: [o.code] } },
            ],
          },
          message: `"None" cannot be combined with other choices`,
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
        if (
          !descriptor.allowedNamespaces.has(field.binding.namespace as any)
        ) {
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

function buildSectionConfig(_section: SectionSpec): SectionConfig {
  return { ui: {}, validation: {}, logic: {} };
}

export async function seedObgynPatientHistoryTemplate(prisma: PrismaClient) {
  emitNoneExclusivityPredicates();
  assertAllValid();

  const gynSpecialty = await prisma.specialty.findUnique({
    where: { code: 'GYN' },
  });

  const template = await prisma.formTemplate.upsert({
    where: {
      code_version: { code: TEMPLATE_CODE, version: TEMPLATE_VERSION },
    },
    update: {
      name: 'OB/GYN Patient History',
      description:
        'Patient-level OB/GYN history surface. Writes via the unified bulk PATCH /patients/:id/obgyn-history.',
      scope: 'PATIENT_HISTORY',
      specialty_id: gynSpecialty?.id ?? null,
      parent_template_id: null,
      extension_key: null,
    },
    create: {
      code: TEMPLATE_CODE,
      version: TEMPLATE_VERSION,
      name: 'OB/GYN Patient History',
      description:
        'Patient-level OB/GYN history surface. Writes via the unified bulk PATCH /patients/:id/obgyn-history.',
      scope: 'PATIENT_HISTORY',
      status: 'DRAFT',
      specialty_id: gynSpecialty?.id ?? null,
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
        is_repeatable: sectionSpec.is_repeatable ?? false,
        config: buildSectionConfig(sectionSpec),
      },
      create: {
        form_template_id: template.id,
        code: sectionSpec.code,
        name: sectionSpec.name,
        order: i,
        is_repeatable: sectionSpec.is_repeatable ?? false,
        config: buildSectionConfig(sectionSpec),
      },
    });

    for (let j = 0; j < sectionSpec.fields.length; j++) {
      const fieldSpec = sectionSpec.fields[j];
      const cfg = fieldSpec.config ?? { ui: {}, validation: {}, logic: {} };
      await prisma.formField.upsert({
        where: {
          section_id_code: { section_id: section.id, code: fieldSpec.code },
        },
        update: {
          label: fieldSpec.label,
          type: fieldSpec.type,
          order: j,
          required: fieldSpec.required ?? false,
          binding_namespace: fieldSpec.binding?.namespace ?? null,
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
          binding_namespace: fieldSpec.binding?.namespace ?? null,
          binding_path: fieldSpec.binding?.path ?? null,
          config: cfg,
        },
      });
    }
  }

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
        activated_at: template.activated_at ?? new Date(),
        status: 'PUBLISHED',
        published_at: template.published_at ?? new Date(),
      },
    }),
  ]);

  console.log(
    `Seeded ${TEMPLATE_CODE} v${TEMPLATE_VERSION} (${SECTIONS.length} sections, activated).`,
  );
}
