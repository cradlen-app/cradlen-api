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
const TEMPLATE_VERSION = 4;

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
  /**
   * Top-level grouping rendered by the frontend as a single heading
   * (e.g. "Gynecological History"). Sections sharing the same `group`
   * collapse together under one eye-icon toggle.
   */
  group: string;
  is_repeatable?: boolean;
  fields: FieldSpec[];
}

const opt = (code: string, label: string) => ({ code, label });

const SECTIONS: SectionSpec[] = [
  {
    code: 'menstrual_history',
    name: 'Menstrual History',
    group: 'Gynecological History',
    fields: [
      {
        code: 'age_at_menarche',
        label: 'Age at menarche',
        type: 'NUMBER',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'gynecological_baseline.age_at_menarche',
        },
        config: {
          ui: { placeholder: 'Ex : 18 years', colSpan: 4 },
          validation: { min: 5, max: 25 },
        },
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
          ui: { placeholder: 'Ex : Regular', colSpan: 4 },
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
        config: { ui: { placeholder: 'Ex : 5 days', colSpan: 4 } },
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
          ui: { placeholder: 'Ex : Moderate', colSpan: 4 },
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
          ui: { placeholder: 'Ex : No', colSpan: 4 },
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
    group: 'Gynecological History',
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
          ui: { variant: 'checkboxes' },
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
      },
    ],
  },
  {
    code: 'contraceptives',
    name: 'Contraceptive History',
    group: 'Gynecological History',
    is_repeatable: true,
    fields: [
      {
        code: 'method',
        label: 'Method',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'contraceptives.method',
        },
        config: {
          ui: { placeholder: 'Ex : Regular', colSpan: 4 },
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
        config: { ui: { placeholder: 'Ex : 5 days', colSpan: 4 } },
      },
      {
        code: 'complications',
        label: 'Complications',
        type: 'TEXT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'contraceptives.complications',
        },
        config: { ui: { placeholder: 'Ex : Complications', colSpan: 4 } },
      },
    ],
  },
  {
    code: 'screening_vaccinations',
    name: 'Screening & Vaccinations',
    group: 'Gynecological History',
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
          ui: { placeholder: 'Ex : Up-to-date', colSpan: 6 },
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
        label: 'Date',
        type: 'DATE',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'screening_history.pap_smear_date',
        },
        config: { ui: { placeholder: 'Ex : 1/1/2026', colSpan: 6 } },
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
          ui: { placeholder: 'Ex : Yes', colSpan: 6 },
          validation: {
            options: [opt('YES', 'Yes'), opt('NO', 'No')],
          },
        },
      },
      {
        code: 'mammography_date',
        label: 'Date',
        type: 'DATE',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'screening_history.mammography_date',
        },
        config: { ui: { placeholder: 'Ex : 1/1/2026', colSpan: 6 } },
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
          ui: { variant: 'checkboxes' },
          validation: {
            options: [
              opt('HPV', 'HPV'),
              opt('HEP_B', 'Hep B'),
              opt('OTHER', 'Other'),
            ],
          },
        },
      },
      {
        code: 'hpv_result',
        label: 'HPV test result',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'screening_history.hpv_result',
        },
        config: {
          ui: { placeholder: 'Ex : Negative', colSpan: 6 },
          validation: {
            options: [
              opt('POSITIVE', 'Positive'),
              opt('NEGATIVE', 'Negative'),
              opt('PENDING', 'Pending'),
              opt('NOT_DONE', 'Not done'),
            ],
          },
        },
      },
      {
        code: 'bethesda_category',
        label: 'Bethesda category',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'screening_history.bethesda_category',
        },
        config: {
          ui: { placeholder: 'Ex : NILM', colSpan: 6 },
          validation: {
            options: [
              opt('NILM', 'NILM (Normal)'),
              opt('ASCUS', 'ASC-US'),
              opt('ASC_H', 'ASC-H'),
              opt('LSIL', 'LSIL'),
              opt('HSIL', 'HSIL'),
              opt('AGC', 'AGC'),
              opt('AIS', 'AIS'),
              opt('SQUAMOUS_CELL_CARCINOMA', 'Squamous cell carcinoma'),
              opt('NOT_DONE', 'Not done'),
            ],
          },
        },
      },
    ],
  },
  {
    code: 'social_history',
    name: 'Social History',
    group: 'Social History',
    fields: [
      {
        code: 'smoking',
        label: 'Smoking',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'social_history.smoking',
        },
        config: {
          ui: { placeholder: 'Ex : Never', colSpan: 4 },
          validation: {
            options: [
              opt('NEVER', 'Never'),
              opt('CURRENT', 'Current'),
              opt('FORMER', 'Former'),
            ],
          },
        },
      },
      {
        code: 'alcohol',
        label: 'Alcohol use',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'social_history.alcohol',
        },
        config: {
          ui: { placeholder: 'Ex : Never', colSpan: 4 },
          validation: {
            options: [
              opt('NEVER', 'Never'),
              opt('OCCASIONAL', 'Occasional'),
              opt('REGULAR', 'Regular'),
              opt('FORMER', 'Former'),
            ],
          },
        },
      },
      {
        code: 'occupation',
        label: 'Occupation',
        type: 'TEXT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'social_history.occupation',
        },
        config: { ui: { placeholder: 'Ex : Teacher', colSpan: 4 } },
      },
      {
        code: 'blood_group_rh',
        label: 'Blood group / Rh',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'blood_group_rh',
        },
        config: {
          ui: { placeholder: 'Ex : O+', colSpan: 4 },
          validation: {
            options: [
              opt('A_POS', 'A+'),
              opt('A_NEG', 'A−'),
              opt('B_POS', 'B+'),
              opt('B_NEG', 'B−'),
              opt('AB_POS', 'AB+'),
              opt('AB_NEG', 'AB−'),
              opt('O_POS', 'O+'),
              opt('O_NEG', 'O−'),
            ],
          },
        },
      },
    ],
  },
  {
    code: 'obstetric_summary',
    name: 'Obstetric History',
    group: 'Obstetric History',
    fields: [
      {
        code: 'gravida',
        label: 'Gravida',
        type: 'NUMBER',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'obstetric_summary.gravida',
        },
        config: {
          ui: { placeholder: 'Ex : one', colSpan: 4 },
          validation: { min: 0 },
        },
      },
      {
        code: 'para',
        label: 'Para',
        type: 'NUMBER',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'obstetric_summary.para',
        },
        config: {
          ui: { placeholder: 'Ex : one', colSpan: 4 },
          validation: { min: 0 },
        },
      },
      {
        code: 'abortion',
        label: 'Abortion',
        type: 'NUMBER',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'obstetric_summary.abortion',
        },
        config: {
          ui: { placeholder: 'Ex : one', colSpan: 4 },
          validation: { min: 0 },
        },
      },
      {
        code: 'ectopic',
        label: 'Ectopic',
        type: 'NUMBER',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'obstetric_summary.ectopic',
        },
        config: {
          ui: { placeholder: 'Ex : one', colSpan: 4 },
          validation: { min: 0 },
        },
      },
      {
        code: 'stillbirths',
        label: 'Stillbirths',
        type: 'NUMBER',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'obstetric_summary.stillbirths',
        },
        config: {
          ui: { placeholder: 'Ex : one', colSpan: 4 },
          validation: { min: 0 },
        },
      },
    ],
  },
  {
    code: 'pregnancies',
    name: 'Previous Pregnancy Details',
    group: 'Obstetric History',
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
        config: { ui: { placeholder: 'Ex : 1/1/2026', colSpan: 4 } },
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
          ui: { placeholder: 'Ex : Live birth', colSpan: 4 },
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
          ui: { placeholder: 'Ex : Vaginal', colSpan: 4 },
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
        label: 'Gestational age at delivery',
        type: 'NUMBER',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'pregnancies.gestational_age_weeks',
        },
        config: {
          ui: { placeholder: 'Ex : 40 week', colSpan: 6 },
          validation: { min: 0, max: 45 },
        },
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
          ui: { placeholder: 'Ex : Live birth', colSpan: 6 },
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
    group: 'Medical History',
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
          ui: { variant: 'checkboxes' },
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
      },
    ],
  },
  {
    code: 'non_gyn_surgeries',
    name: 'Previous Surgeries (Non-gynecologic)',
    group: 'Medical History',
    is_repeatable: true,
    fields: [
      {
        code: 'surgery_name',
        label: 'Surgery name',
        type: 'TEXT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'non_gyn_surgeries.surgery_name',
        },
        config: { ui: { placeholder: 'Ex : Up-to-date', colSpan: 6 } },
      },
      {
        code: 'surgery_date',
        label: 'Date',
        type: 'DATE',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'non_gyn_surgeries.surgery_date',
        },
        config: { ui: { placeholder: 'Ex : 1/1/2026', colSpan: 6 } },
      },
    ],
  },
  {
    code: 'allergies',
    name: 'Allergies',
    group: 'Medical History',
    is_repeatable: true,
    fields: [
      {
        code: 'allergy_to',
        label: 'Allergy to',
        type: 'TEXT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'allergies.allergy_to',
        },
        config: { ui: { placeholder: 'Ex : Up-to-date', colSpan: 6 } },
      },
      {
        code: 'associated_symptoms',
        label: 'Associated symptoms',
        type: 'TEXT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'allergies.associated_symptoms',
        },
        config: { ui: { placeholder: 'Ex : Complications', colSpan: 6 } },
      },
    ],
  },
  {
    code: 'medications',
    name: 'Medications (current / past, long-term)',
    group: 'Medical History',
    is_repeatable: true,
    fields: [
      {
        code: 'drug_name',
        label: 'Drug name',
        type: 'ENTITY_SEARCH',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'medications.drug_name',
        },
        config: {
          ui: {
            placeholder: 'Ex : candalkan',
            colSpan: 4,
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
        config: { ui: { placeholder: 'Blood pressure medications', colSpan: 4 } },
      },
      {
        code: 'from_date',
        label: 'From',
        type: 'DATE',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'medications.from_date',
        },
        config: { ui: { placeholder: 'Ex : 1/1/2026', colSpan: 3 } },
      },
      {
        code: 'dose',
        label: 'Dose',
        type: 'TEXT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'medications.dose',
        },
        config: { ui: { placeholder: 'Ex : 500mg', colSpan: 3 } },
      },
      {
        code: 'frequency',
        label: 'Frequency',
        type: 'TEXT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'medications.frequency',
        },
        config: { ui: { placeholder: 'Ex : twice daily', colSpan: 3 } },
      },
      {
        code: 'to_date',
        label: 'To',
        type: 'DATE',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'medications.to_date',
        },
        config: { ui: { placeholder: 'Ex : 1/1/2026', colSpan: 3 } },
      },
      {
        code: 'is_ongoing',
        label: 'Ongoing',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'medications.is_ongoing',
        },
        config: {
          ui: { placeholder: 'Ex : Yes', colSpan: 3 },
          validation: {
            options: [opt('YES', 'Yes'), opt('NO', 'No')],
          },
        },
      },
    ],
  },
  {
    code: 'family_history',
    name: 'Family History',
    group: 'Family History',
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
          ui: { variant: 'checkboxes' },
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
          ui: { variant: 'checkboxes' },
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
        config: { ui: { placeholder: 'Ex : Complications' } },
      },
    ],
  },
  {
    code: 'menopause_history',
    name: 'Menopause History',
    group: 'Menopause & HRT',
    fields: [
      {
        code: 'menopausal_status',
        label: 'Menopausal status',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'menopause_history.menopausal_status',
        },
        config: {
          ui: { placeholder: 'Ex : Pre-menopausal', colSpan: 6 },
          validation: {
            options: [
              opt('PRE', 'Pre-menopausal'),
              opt('PERI', 'Peri-menopausal'),
              opt('POST', 'Post-menopausal'),
              opt('PREMATURE', 'Premature menopause'),
            ],
          },
        },
      },
      {
        code: 'age_at_menopause',
        label: 'Age at menopause',
        type: 'NUMBER',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'menopause_history.age_at_menopause',
        },
        config: {
          ui: { placeholder: 'Ex : 52', colSpan: 6 },
          validation: { min: 30, max: 65 },
          logic: {
            predicates: [
              {
                effect: 'visible',
                when: {
                  in: { 'menopause_history.menopausal_status': ['POST', 'PREMATURE'] },
                },
              } as Predicate,
            ],
          },
        },
      },
      {
        code: 'hrt_current',
        label: 'On HRT',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'menopause_history.hrt_current',
        },
        config: {
          ui: { placeholder: 'Ex : No', colSpan: 6 },
          validation: {
            options: [opt('YES', 'Yes'), opt('NO', 'No')],
          },
        },
      },
      {
        code: 'hrt_details',
        label: 'HRT details',
        type: 'TEXTAREA',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'menopause_history.hrt_details',
        },
        config: {
          ui: { placeholder: 'Ex : Estrogen-only patch since 2022' },
          logic: {
            predicates: [
              {
                effect: 'visible',
                when: { eq: { 'menopause_history.hrt_current': 'YES' } },
              } as Predicate,
            ],
          },
        },
      },
    ],
  },
  {
    code: 'fertility_history',
    name: 'Fertility History',
    group: 'Fertility History',
    fields: [
      {
        code: 'duration_of_infertility',
        label: 'Duration of infertility',
        type: 'TEXT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'fertility_history.duration_of_infertility',
        },
        config: { ui: { placeholder: 'Ex : 3 years', colSpan: 6 } },
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
          ui: { placeholder: 'Ex : Normal', colSpan: 6 },
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
          ui: { variant: 'checkboxes' },
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
        config: { ui: { placeholder: 'Ex : Complications' } },
      },
      {
        code: 'past_pregnancies_outcomes',
        label: 'Past pregnancies & outcomes',
        type: 'TEXTAREA',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'fertility_history.past_pregnancies_outcomes',
        },
        config: { ui: { placeholder: 'Ex : Complications' } },
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

function buildSectionConfig(section: SectionSpec): SectionConfig {
  return {
    ui: { group: section.group },
    validation: {},
    logic: {},
  };
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
