/**
 * OB/GYN Examination template seed.
 *
 * Standalone form template (code='obgyn_examination') that drives the
 * Examination tab inside the visit workspace. Bindings target a unified
 * bulk `PATCH /visits/:id/examination` endpoint that fans the payload
 * across five existing aggregates inside one Prisma transaction:
 *
 *   - VisitEncounter      (chief complaint + provisional diagnosis)
 *   - VisitVitals         (BP, pulse, temperature, weight, height; BMI computed)
 *   - VisitObgynEncounter (menstrual/abdominal/pelvic/breast JSON sections)
 *   - VisitInvestigation  (repeatable child collection)
 *   - Prescription + PrescriptionItem (singleton + repeatable items)
 *   - Visit               (follow_up_date + examination_version)
 *
 * Section conventions mirror `obgyn-patient-history.ts`:
 *  - `is_repeatable=true` sections describe ONE row; their `code` matches
 *    the body array key on the unified PATCH DTO.
 *  - The eye-icon "notes" affordance per group reuses `PatientHistoryNote`
 *    keyed on `section_code = slug(group)`.
 *  - The Case path field uses `ui.variant='segmented'` (renders as pill
 *    buttons rather than a dropdown).
 *  - BMI is `COMPUTED` (server recomputes; client value advisory).
 *
 * Activation: ends with a $transaction that deactivates prior active rows
 * for code='obgyn_examination' and flips this one to active + PUBLISHED.
 * Idempotent (upsert by (code, version)).
 */

import { BindingNamespace, PrismaClient } from '@prisma/client';
import { validateBinding } from '../../src/builder/fields/allowed-paths.js';
import { assertValidConfig } from '../../src/builder/fields/field-config.schema.js';
import { FIELD_TYPES } from '../../src/builder/fields/field-type.registry.js';

const TEMPLATE_CODE = 'obgyn_examination';
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
  group: string;
  is_repeatable?: boolean;
  fields: FieldSpec[];
}

const opt = (code: string, label: string) => ({ code, label });

const SECTIONS: SectionSpec[] = [
  // ---------------------------------------------------------------------------
  // 1. Main Complaint  (VisitEncounter)
  // ---------------------------------------------------------------------------
  {
    code: 'main_complaint',
    name: 'Main Complaint',
    group: 'Main Complaint',
    fields: [
      {
        code: 'complaint_category',
        label: 'Complaint category',
        type: 'MULTISELECT',
        binding: {
          namespace: 'VISIT_ENCOUNTER',
          path: 'chief_complaint_meta.categories',
        },
        config: {
          ui: { variant: 'checkboxes', colSpan: 12 },
          validation: {
            options: [
              opt('ROUTINE_CHECK', 'Routine check'),
              opt('PAIN', 'Pain'),
              opt('BLEEDING', 'Bleeding'),
              opt('INFERTILITY', 'Infertility'),
            ],
          },
        },
      },
      {
        code: 'onset',
        label: 'Onset',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_ENCOUNTER',
          path: 'chief_complaint_meta.onset',
        },
        config: {
          ui: { placeholder: 'Ex : Acute', colSpan: 4 },
          validation: {
            options: [
              opt('ACUTE', 'Acute'),
              opt('SUBACUTE', 'Subacute'),
              opt('CHRONIC', 'Chronic'),
            ],
          },
        },
      },
      {
        code: 'duration',
        label: 'Duration',
        type: 'TEXT',
        binding: {
          namespace: 'VISIT_ENCOUNTER',
          path: 'chief_complaint_meta.duration',
        },
        config: { ui: { placeholder: 'Ex : 5 days', colSpan: 4 } },
      },
      {
        code: 'severity',
        label: 'Severity',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_ENCOUNTER',
          path: 'chief_complaint_meta.severity',
        },
        config: {
          ui: { placeholder: 'Ex : Moderate', colSpan: 4 },
          validation: {
            options: [
              opt('MILD', 'Mild'),
              opt('MODERATE', 'Moderate'),
              opt('SEVERE', 'Severe'),
            ],
          },
        },
      },
      {
        code: 'complaint',
        label: 'Complaint',
        type: 'TEXTAREA',
        binding: {
          namespace: 'VISIT_ENCOUNTER',
          path: 'chief_complaint',
        },
        config: { ui: { placeholder: 'Ex : Complaint', colSpan: 12 } },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 2. Vitals  (VisitVitals)
  // ---------------------------------------------------------------------------
  {
    code: 'vitals',
    name: 'Vitals',
    group: 'Vitals',
    fields: [
      {
        code: 'systolic_bp',
        label: 'BP (systolic)',
        type: 'NUMBER',
        binding: { namespace: 'VISIT_VITALS', path: 'systolic_bp' },
        config: {
          ui: { placeholder: 'Ex : 120', colSpan: 2, suffix: 'mmHg' },
          validation: { min: 50, max: 250 },
        },
      },
      {
        code: 'diastolic_bp',
        label: 'BP (diastolic)',
        type: 'NUMBER',
        binding: { namespace: 'VISIT_VITALS', path: 'diastolic_bp' },
        config: {
          ui: { placeholder: 'Ex : 80', colSpan: 2, suffix: 'mmHg' },
          validation: { min: 30, max: 200 },
        },
      },
      {
        code: 'pulse',
        label: 'Pulse',
        type: 'NUMBER',
        binding: { namespace: 'VISIT_VITALS', path: 'pulse' },
        config: {
          ui: { placeholder: 'Ex : 60', colSpan: 2, suffix: 'bpm' },
          validation: { min: 20, max: 250 },
        },
      },
      {
        code: 'temperature_c',
        label: 'Temperature',
        type: 'NUMBER',
        binding: { namespace: 'VISIT_VITALS', path: 'temperature_c' },
        config: {
          ui: { placeholder: 'Ex : 37', colSpan: 2, suffix: '°C', step: 0.1 },
          validation: { min: 30, max: 45 },
        },
      },
      {
        code: 'weight_kg',
        label: 'Weight',
        type: 'NUMBER',
        binding: { namespace: 'VISIT_VITALS', path: 'weight_kg' },
        config: {
          ui: { placeholder: 'Ex : 60', colSpan: 2, suffix: 'kg', step: 0.1 },
          validation: { min: 1, max: 400 },
        },
      },
      {
        code: 'height_cm',
        label: 'Height',
        type: 'NUMBER',
        binding: { namespace: 'VISIT_VITALS', path: 'height_cm' },
        config: {
          ui: { placeholder: 'Ex : 160', colSpan: 2, suffix: 'cm', step: 0.1 },
          validation: { min: 30, max: 250 },
        },
      },
      {
        code: 'bmi',
        label: 'BMI',
        type: 'COMPUTED',
        binding: { namespace: 'COMPUTED', path: 'vitals.bmi' },
        config: {
          ui: {
            placeholder: 'Ex : 22',
            colSpan: 2,
            suffix: 'kg/m²',
            derivedFrom: ['weight_kg', 'height_cm'],
          },
          logic: { formula: 'weight_kg / ((height_cm / 100) ^ 2)' },
        },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 3. Menstrual Exam  (VisitObgynEncounter.menstrual_findings)
  // ---------------------------------------------------------------------------
  {
    code: 'menstrual_exam',
    name: 'Menstrual',
    group: 'Examination',
    fields: [
      {
        code: 'lmp',
        label: 'LMP',
        type: 'DATE',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'menstrual_findings.lmp',
        },
        config: { ui: { placeholder: '1 / 1 / 2026', colSpan: 4 } },
      },
      {
        code: 'cycle',
        label: 'Cycle since last visit',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'menstrual_findings.cycle',
        },
        config: {
          ui: { placeholder: 'Ex : Regular', colSpan: 4 },
          validation: {
            options: [
              opt('REGULAR', 'Regular'),
              opt('IRREGULAR', 'Irregular'),
              opt('ABSENT', 'Absent'),
            ],
          },
        },
      },
      {
        code: 'pelvic_pain',
        label: 'Pelvic pain',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'menstrual_findings.pelvic_pain',
        },
        config: {
          ui: { placeholder: 'Ex : Mild', colSpan: 4 },
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
      {
        code: 'pelvic_pain_type',
        label: 'Type',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'menstrual_findings.pelvic_pain_type',
        },
        config: {
          ui: { placeholder: 'Ex : Crampy', colSpan: 4 },
          validation: {
            options: [
              opt('CRAMPY', 'Crampy'),
              opt('DULL', 'Dull'),
              opt('SHARP', 'Sharp'),
              opt('BURNING', 'Burning'),
            ],
          },
        },
      },
      {
        code: 'vaginal_discharge',
        label: 'Vaginal discharge',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'menstrual_findings.vaginal_discharge',
        },
        config: {
          ui: { placeholder: 'Ex : Present', colSpan: 3 },
          validation: {
            options: [opt('PRESENT', 'Present'), opt('ABSENT', 'Absent')],
          },
        },
      },
      {
        code: 'discharge_color',
        label: 'Color',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'menstrual_findings.discharge_color',
        },
        config: {
          ui: { placeholder: 'Ex : Clear', colSpan: 3 },
          validation: {
            options: [
              opt('CLEAR', 'Clear'),
              opt('WHITE', 'White'),
              opt('YELLOW', 'Yellow'),
              opt('GREEN', 'Green'),
              opt('BROWN', 'Brown'),
            ],
          },
        },
      },
      {
        code: 'discharge_odor',
        label: 'Odor',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'menstrual_findings.discharge_odor',
        },
        config: {
          ui: { placeholder: 'Ex : No', colSpan: 3 },
          validation: {
            options: [opt('NONE', 'No'), opt('FISHY', 'Fishy'), opt('FOUL', 'Foul')],
          },
        },
      },
      {
        code: 'discharge_amount',
        label: 'Amount',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'menstrual_findings.discharge_amount',
        },
        config: {
          ui: { placeholder: 'Ex : No', colSpan: 3 },
          validation: {
            options: [
              opt('NONE', 'No'),
              opt('SCANT', 'Scant'),
              opt('MODERATE', 'Moderate'),
              opt('HEAVY', 'Heavy'),
            ],
          },
        },
      },
      {
        code: 'intermenstrual_bleeding',
        label: 'Intermenstrual bleeding',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'menstrual_findings.intermenstrual_bleeding',
        },
        config: {
          ui: { placeholder: 'Ex : No', colSpan: 6 },
          validation: {
            options: [opt('YES', 'Yes'), opt('NO', 'No')],
          },
        },
      },
      {
        code: 'post_coital_bleeding',
        label: 'Post-coital bleeding',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'menstrual_findings.post_coital_bleeding',
        },
        config: {
          ui: { placeholder: 'Ex : No', colSpan: 6 },
          validation: {
            options: [opt('YES', 'Yes'), opt('NO', 'No')],
          },
        },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 4. Abdominal Exam  (VisitObgynEncounter.abdominal_findings)
  // ---------------------------------------------------------------------------
  {
    code: 'abdominal_exam',
    name: 'Abdominal',
    group: 'Examination',
    fields: [
      {
        code: 'inspection',
        label: 'Inspection',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'abdominal_findings.inspection',
        },
        config: {
          ui: { placeholder: 'Ex : Distended', colSpan: 3 },
          validation: {
            options: [
              opt('NORMAL', 'Normal'),
              opt('DISTENDED', 'Distended'),
              opt('SCAPHOID', 'Scaphoid'),
              opt('SCARS', 'Scars'),
            ],
          },
        },
      },
      {
        code: 'guarding',
        label: 'Guarding',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'abdominal_findings.guarding',
        },
        config: {
          ui: { placeholder: 'Ex : Distended', colSpan: 3 },
          validation: {
            options: [
              opt('NONE', 'None'),
              opt('VOLUNTARY', 'Voluntary'),
              opt('INVOLUNTARY', 'Involuntary'),
            ],
          },
        },
      },
      {
        code: 'tenderness',
        label: 'Tenderness',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'abdominal_findings.tenderness',
        },
        config: {
          ui: { placeholder: 'Ex : Mild', colSpan: 3 },
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
      {
        code: 'tenderness_site',
        label: 'Site',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'abdominal_findings.tenderness_site',
        },
        config: {
          ui: { placeholder: 'Ex : Generalized', colSpan: 3 },
          validation: {
            options: [
              opt('GENERALIZED', 'Generalized'),
              opt('RUQ', 'RUQ'),
              opt('LUQ', 'LUQ'),
              opt('RLQ', 'RLQ'),
              opt('LLQ', 'LLQ'),
              opt('SUPRAPUBIC', 'Suprapubic'),
            ],
          },
        },
      },
      {
        code: 'mass',
        label: 'Mass',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'abdominal_findings.mass',
        },
        config: {
          ui: { placeholder: 'Ex : Present', colSpan: 3 },
          validation: {
            options: [opt('PRESENT', 'Present'), opt('ABSENT', 'Absent')],
          },
        },
      },
      {
        code: 'mass_site',
        label: 'Site',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'abdominal_findings.mass_site',
        },
        config: {
          ui: { placeholder: 'Ex : Suprapubic', colSpan: 3 },
          validation: {
            options: [
              opt('SUPRAPUBIC', 'Suprapubic'),
              opt('RIGHT_ILIAC', 'Right iliac'),
              opt('LEFT_ILIAC', 'Left iliac'),
              opt('UMBILICAL', 'Umbilical'),
            ],
          },
        },
      },
      {
        code: 'mass_size',
        label: 'Size',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'abdominal_findings.mass_size',
        },
        config: {
          ui: { placeholder: 'Ex : Medium', colSpan: 3 },
          validation: {
            options: [
              opt('SMALL', 'Small'),
              opt('MEDIUM', 'Medium'),
              opt('LARGE', 'Large'),
            ],
          },
        },
      },
      {
        code: 'mass_tenderness',
        label: 'Tenderness',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'abdominal_findings.mass_tenderness',
        },
        config: {
          ui: { placeholder: 'Ex : Mild', colSpan: 3 },
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

  // ---------------------------------------------------------------------------
  // 5. Pelvic — Speculum  (VisitObgynEncounter.pelvic_findings.speculum)
  // ---------------------------------------------------------------------------
  {
    code: 'pelvic_speculum',
    name: 'Speculum Examination',
    group: 'Examination',
    fields: [
      {
        code: 'cervix',
        label: 'Cervix',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'pelvic_findings.speculum.cervix',
        },
        config: {
          ui: { placeholder: 'Ex : Normal', colSpan: 4 },
          validation: {
            options: [
              opt('NORMAL', 'Normal'),
              opt('INFLAMED', 'Inflamed'),
              opt('FRIABLE', 'Friable'),
              opt('POLYP', 'Polyp'),
            ],
          },
        },
      },
      {
        code: 'vagina',
        label: 'Vagina',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'pelvic_findings.speculum.vagina',
        },
        config: {
          ui: { placeholder: 'Ex : Normal', colSpan: 4 },
          validation: {
            options: [
              opt('NORMAL', 'Normal'),
              opt('INFLAMED', 'Inflamed'),
              opt('DISCHARGE', 'Discharge'),
            ],
          },
        },
      },
      {
        code: 'os',
        label: 'Os',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'pelvic_findings.speculum.os',
        },
        config: {
          ui: { placeholder: 'Ex : Normal', colSpan: 4 },
          validation: {
            options: [
              opt('CLOSED', 'Closed'),
              opt('OPEN', 'Open'),
              opt('NORMAL', 'Normal'),
            ],
          },
        },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 6. Pelvic — Bimanual / Uterus  (pelvic_findings.bimanual.uterus.*)
  // ---------------------------------------------------------------------------
  {
    code: 'pelvic_bimanual_uterus',
    name: 'Bimanual Examination — Uterus',
    group: 'Examination',
    fields: [
      {
        code: 'size',
        label: 'Size',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'pelvic_findings.bimanual.uterus.size',
        },
        config: {
          ui: { placeholder: 'Ex : Normal', colSpan: 4 },
          validation: {
            options: [
              opt('NORMAL', 'Normal'),
              opt('ENLARGED', 'Enlarged'),
              opt('SMALL', 'Small'),
            ],
          },
        },
      },
      {
        code: 'position',
        label: 'Position',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'pelvic_findings.bimanual.uterus.position',
        },
        config: {
          ui: { placeholder: 'Ex : Normal', colSpan: 4 },
          validation: {
            options: [
              opt('ANTEVERTED', 'Anteverted'),
              opt('RETROVERTED', 'Retroverted'),
              opt('MIDPOSITION', 'Midposition'),
            ],
          },
        },
      },
      {
        code: 'mobility',
        label: 'Mobility',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'pelvic_findings.bimanual.uterus.mobility',
        },
        config: {
          ui: { placeholder: 'Ex : Mobile', colSpan: 4 },
          validation: {
            options: [
              opt('MOBILE', 'Mobile'),
              opt('FIXED', 'Fixed'),
              opt('RESTRICTED', 'Restricted'),
            ],
          },
        },
      },
      {
        code: 'tenderness',
        label: 'Tenderness',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'pelvic_findings.bimanual.uterus.tenderness',
        },
        config: {
          ui: { placeholder: 'Ex : No', colSpan: 6 },
          validation: {
            options: [opt('YES', 'Yes'), opt('NO', 'No')],
          },
        },
      },
      {
        code: 'surface',
        label: 'Surface',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'pelvic_findings.bimanual.uterus.surface',
        },
        config: {
          ui: { placeholder: 'Ex : Normal', colSpan: 6 },
          validation: {
            options: [
              opt('SMOOTH', 'Smooth'),
              opt('IRREGULAR', 'Irregular'),
              opt('NODULAR', 'Nodular'),
            ],
          },
        },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 7. Pelvic — Bimanual / Adnexa  (pelvic_findings.bimanual.adnexa.*)
  // ---------------------------------------------------------------------------
  {
    code: 'pelvic_bimanual_adnexa',
    name: 'Bimanual Examination — Adnexa',
    group: 'Examination',
    fields: [
      {
        code: 'adnexa_right',
        label: 'Adnexa — Right',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'pelvic_findings.bimanual.adnexa.right',
        },
        config: {
          ui: { placeholder: 'Ex : Normal', colSpan: 4 },
          validation: {
            options: [
              opt('NORMAL', 'Normal'),
              opt('TENDER', 'Tender'),
              opt('MASS', 'Mass'),
            ],
          },
        },
      },
      {
        code: 'adnexa_left',
        label: 'Adnexa — Left',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'pelvic_findings.bimanual.adnexa.left',
        },
        config: {
          ui: { placeholder: 'Ex : Normal', colSpan: 4 },
          validation: {
            options: [
              opt('NORMAL', 'Normal'),
              opt('TENDER', 'Tender'),
              opt('MASS', 'Mass'),
            ],
          },
        },
      },
      {
        code: 'cervical_motion_tenderness',
        label: 'Cervical motion tenderness',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'pelvic_findings.bimanual.adnexa.cervical_motion_tenderness',
        },
        config: {
          ui: { placeholder: 'Ex : Normal', colSpan: 4 },
          validation: {
            options: [opt('YES', 'Yes'), opt('NO', 'No')],
          },
        },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 8. Breast Exam  (VisitObgynEncounter.breast_findings)
  // ---------------------------------------------------------------------------
  {
    code: 'breast_exam',
    name: 'Breast',
    group: 'Examination',
    fields: [
      {
        code: 'insp_skin',
        label: 'Inspection — Skin',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'breast_findings.inspection.skin',
        },
        config: {
          ui: { placeholder: 'Ex : Normal', colSpan: 3 },
          validation: {
            options: [
              opt('NORMAL', 'Normal'),
              opt('DIMPLING', 'Dimpling'),
              opt('PEAU_DORANGE', "Peau d'orange"),
            ],
          },
        },
      },
      {
        code: 'insp_nipple',
        label: 'Nipple',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'breast_findings.inspection.nipple',
        },
        config: {
          ui: { placeholder: 'Ex : Discharge', colSpan: 3 },
          validation: {
            options: [
              opt('NORMAL', 'Normal'),
              opt('DISCHARGE', 'Discharge'),
              opt('INVERTED', 'Inverted'),
            ],
          },
        },
      },
      {
        code: 'insp_color',
        label: 'Color',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'breast_findings.inspection.color',
        },
        config: {
          ui: { placeholder: 'Ex : Normal', colSpan: 3 },
          validation: {
            options: [
              opt('NORMAL', 'Normal'),
              opt('ERYTHEMA', 'Erythema'),
              opt('PALLOR', 'Pallor'),
            ],
          },
        },
      },
      {
        code: 'insp_site',
        label: 'Site',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'breast_findings.inspection.site',
        },
        config: {
          ui: { placeholder: 'Ex : Normal', colSpan: 3 },
          validation: {
            options: [
              opt('NORMAL', 'Normal'),
              opt('RIGHT', 'Right'),
              opt('LEFT', 'Left'),
              opt('BILATERAL', 'Bilateral'),
            ],
          },
        },
      },
      {
        code: 'palp_right',
        label: 'Palpation — Right',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'breast_findings.palpation.right',
        },
        config: {
          ui: { placeholder: 'Ex : Normal', colSpan: 6 },
          validation: {
            options: [
              opt('NORMAL', 'Normal'),
              opt('TENDER', 'Tender'),
              opt('MASS', 'Mass'),
              opt('NODULE', 'Nodule'),
            ],
          },
        },
      },
      {
        code: 'palp_left',
        label: 'Palpation — Left',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_OBGYN_ENCOUNTER',
          path: 'breast_findings.palpation.left',
        },
        config: {
          ui: { placeholder: 'Ex : Normal', colSpan: 6 },
          validation: {
            options: [
              opt('NORMAL', 'Normal'),
              opt('TENDER', 'Tender'),
              opt('MASS', 'Mass'),
              opt('NODULE', 'Nodule'),
            ],
          },
        },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 9. Provisional Diagnosis  (VisitEncounter)
  // ---------------------------------------------------------------------------
  {
    code: 'provisional_diagnosis',
    name: 'Provisional Diagnosis',
    group: 'Provisional Diagnosis',
    fields: [
      {
        code: 'diagnosis',
        label: 'Diagnosis',
        type: 'TEXT',
        binding: {
          namespace: 'VISIT_ENCOUNTER',
          path: 'provisional_diagnosis',
        },
        config: { ui: { placeholder: 'Search', colSpan: 8 } },
      },
      {
        code: 'certainty',
        label: 'Certainty',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_ENCOUNTER',
          path: 'diagnosis_certainty',
        },
        config: {
          ui: { placeholder: 'Ex : Confirmed', colSpan: 4 },
          validation: {
            options: [
              opt('SUSPECTED', 'Suspected'),
              opt('PROBABLE', 'Probable'),
              opt('CONFIRMED', 'Confirmed'),
            ],
          },
        },
      },
      {
        code: 'clinical_reasoning',
        label: 'Clinical Reasoning',
        type: 'TEXTAREA',
        binding: {
          namespace: 'VISIT_ENCOUNTER',
          path: 'clinical_reasoning',
        },
        config: { ui: { placeholder: 'Ex : Clinical Reasoning', colSpan: 12 } },
      },
      {
        code: 'case_path',
        label: 'Case path',
        type: 'SELECT',
        binding: {
          namespace: 'VISIT_ENCOUNTER',
          path: 'case_path',
        },
        config: {
          ui: { variant: 'segmented', colSpan: 12 },
          validation: {
            options: [
              opt('GENERAL_GYN', 'General GYN'),
              opt('PREGNANCY', 'Pregnancy'),
              opt('SURGERY', 'Surgery'),
              opt('INFERTILITY', 'Infertility'),
            ],
          },
        },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 10. Investigations  (VisitInvestigation — repeatable)
  // ---------------------------------------------------------------------------
  {
    code: 'investigations',
    name: 'Investigations',
    group: 'Treatment Plan & Investigations',
    is_repeatable: true,
    fields: [
      {
        code: 'custom_test_name',
        label: 'Type',
        type: 'TEXT',
        binding: {
          namespace: 'VISIT_INVESTIGATION',
          path: 'custom_test_name',
        },
        config: { ui: { placeholder: 'Ex : Laboratory test', colSpan: 4 } },
      },
      {
        code: 'lab_test_id',
        label: 'Name',
        type: 'TEXT',
        binding: {
          namespace: 'VISIT_INVESTIGATION',
          path: 'lab_test_id',
        },
        config: { ui: { placeholder: 'Ex : CBC test', colSpan: 4 } },
      },
      {
        code: 'lab_facility',
        label: 'Lab',
        type: 'TEXT',
        binding: {
          namespace: 'VISIT_INVESTIGATION',
          path: 'lab_facility',
        },
        config: { ui: { placeholder: 'Ex : CBC test', colSpan: 4 } },
      },
      {
        code: 'notes',
        label: 'Notes & Instructions',
        type: 'TEXTAREA',
        binding: {
          namespace: 'VISIT_INVESTIGATION',
          path: 'notes',
        },
        config: { ui: { placeholder: 'Ex : Test advices & Notes', colSpan: 12 } },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 11. Medications  (PrescriptionItem — repeatable)
  // ---------------------------------------------------------------------------
  {
    code: 'medications',
    name: 'Medications',
    group: 'Treatment Plan & Investigations',
    is_repeatable: true,
    fields: [
      {
        code: 'custom_drug_name',
        label: 'Drug',
        type: 'TEXT',
        binding: {
          namespace: 'PRESCRIPTION_ITEM',
          path: 'custom_drug_name',
        },
        config: { ui: { placeholder: 'Ex : Hiblotic - 500mg', colSpan: 3 } },
      },
      {
        code: 'frequency',
        label: 'Dose / frequency',
        type: 'TEXT',
        binding: {
          namespace: 'PRESCRIPTION_ITEM',
          path: 'frequency',
        },
        config: { ui: { placeholder: 'Ex : 2 tab / 8 h', colSpan: 3 } },
      },
      {
        code: 'duration_days',
        label: 'Duration',
        type: 'TEXT',
        binding: {
          namespace: 'PRESCRIPTION_ITEM',
          path: 'duration_days',
        },
        config: { ui: { placeholder: 'Ex : 3 months', colSpan: 3 } },
      },
      {
        code: 'instructions',
        label: 'Instructions',
        type: 'TEXT',
        binding: {
          namespace: 'PRESCRIPTION_ITEM',
          path: 'instructions',
        },
        config: { ui: { placeholder: 'Ex : Before launch', colSpan: 3 } },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 12. Follow-up  (Visit.follow_up_date)
  // ---------------------------------------------------------------------------
  {
    code: 'followup',
    name: 'Follow-up',
    group: 'Treatment Plan & Investigations',
    fields: [
      {
        code: 'follow_up_date',
        label: 'Follow-up Date',
        type: 'DATE',
        binding: { namespace: 'VISIT', path: 'follow_up_date' },
        config: { ui: { placeholder: '1 / 1 / 2026', colSpan: 6 } },
      },
    ],
  },
];

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

export async function seedObgynExaminationTemplate(prisma: PrismaClient) {
  assertAllValid();

  const gynSpecialty = await prisma.specialty.findUnique({
    where: { code: 'GYN' },
  });

  const template = await prisma.formTemplate.upsert({
    where: {
      code_version: { code: TEMPLATE_CODE, version: TEMPLATE_VERSION },
    },
    update: {
      name: 'OB/GYN Examination',
      description:
        'Visit-level OB/GYN examination surface. Writes via the unified bulk PATCH /visits/:id/examination.',
      scope: 'ENCOUNTER',
      specialty_id: gynSpecialty?.id ?? null,
      parent_template_id: null,
      extension_key: null,
    },
    create: {
      code: TEMPLATE_CODE,
      version: TEMPLATE_VERSION,
      name: 'OB/GYN Examination',
      description:
        'Visit-level OB/GYN examination surface. Writes via the unified bulk PATCH /visits/:id/examination.',
      scope: 'ENCOUNTER',
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
