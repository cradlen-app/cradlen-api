/**
 * OB/GYN Pregnancy clinical-surface template seed (code='obgyn_pregnancy').
 *
 * Backs the dynamic "Pregnancy" tab the OBGYN_PREGNANCY care path declares. The
 * tab embodies journey → episode → visit, led by a READ-ONLY Summary:
 *
 *   - Summary (read-only, NOT submitted) — at-a-glance overview aggregating
 *     journey + episode + visit; live GA/EDD (COMPUTED) recompute from the
 *     editable journey LMP/US inputs; blood group is read-only from patient
 *     OB/GYN history; created/updated are date-only.
 *   - Journey — dating & profile (editable): LMP (single capture), US dating,
 *     risk, pregnancy type, #fetuses → PREGNANCY_JOURNEY.
 *   - Episode — labs (editable): anomaly scan / GTT / trimester → PREGNANCY_EPISODE.
 *   - Visit — maternal / fetal (editable, fetuses repeatable) → PREGNANCY_VISIT /
 *     PREGNANCY_FETUS.
 *
 * The Summary section is flagged `config.ui.readOnly` — the FE renders it
 * read-only and excludes it from submission (its fields mirror the editable
 * ones, so the editable sections own the writes). Vitals stay on the
 * Examination tab. Activation flips this template active + PUBLISHED. Idempotent.
 */

import { BindingNamespace, PrismaClient } from '@prisma/client';
import { validateBinding } from '../../src/builder/fields/allowed-paths.js';
import { assertValidConfig } from '../../src/builder/fields/field-config.schema.js';
import { FIELD_TYPES } from '../../src/builder/fields/field-type.registry.js';

const TEMPLATE_CODE = 'obgyn_pregnancy';
const TEMPLATE_VERSION = 3;

type FieldType = keyof typeof FIELD_TYPES;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  /** Rendered read-only by the FE and excluded from submission (overview). */
  readOnly?: boolean;
  fields: FieldSpec[];
}

const opt = (code: string, label: string) => ({ code, label });

/** A read-only display field in the Summary (mirrors a value owned elsewhere). */
const display = (
  code: string,
  label: string,
  namespace: BindingNamespace,
  path: string,
  colSpan = 3,
): FieldSpec => ({
  code,
  label,
  type: 'TEXT',
  binding: { namespace, path },
  config: { ui: { readOnly: true, colSpan } },
});

/** A live COMPUTED field (recomputes on the FE from `derivedFrom` field codes). */
const computed = (
  code: string,
  label: string,
  path: string,
  formula: string,
  derivedFrom: string[],
  colSpan = 3,
): FieldSpec => ({
  code,
  label,
  type: 'COMPUTED',
  binding: { namespace: 'COMPUTED', path },
  config: { ui: { colSpan, derivedFrom }, logic: { formula } },
});

/**
 * A read-only Summary field that reflects another editable field's LIVE value
 * (no binding — the value comes from `mirrorOf`, not the envelope). SELECT
 * mirrors carry the source options so codes render as labels.
 */
const mirror = (
  code: string,
  label: string,
  mirrorOf: string,
  type: FieldType = 'TEXT',
  options?: { code: string; label: string }[],
  colSpan = 3,
): FieldSpec => ({
  code,
  label,
  type,
  config: {
    ui: { readOnly: true, mirrorOf, colSpan },
    ...(options ? { validation: { options } } : {}),
  },
});

const SECTIONS: SectionSpec[] = [
  // ---------------------------------------------------------------------------
  // 1. Summary — read-only overview (journey + episode + visit). Not submitted.
  // ---------------------------------------------------------------------------
  {
    code: 'summary',
    name: 'Pregnancy summary',
    group: 'Summary',
    readOnly: true,
    fields: [
      {
        // Editable status: choosing "Closed" opens the outcome drawer (custom
        // input). Binds the journey status so its value hydrates from the GET.
        code: 'status',
        label: 'Status',
        type: 'SELECT',
        binding: { namespace: 'PREGNANCY_JOURNEY', path: 'status' },
        config: {
          ui: { variant: 'pregnancy-status', colSpan: 3 },
          validation: {
            options: [opt('ACTIVE', 'Active'), opt('CLOSED', 'Closed')],
          },
        },
      },
      mirror('summary_risk', 'Risk level', 'risk_level', 'SELECT', [
        opt('NORMAL', 'Normal'),
        opt('MODERATE', 'Moderate'),
        opt('HIGH', 'High'),
      ]),
      display(
        'summary_blood_group',
        'Blood group & RH',
        'PATIENT_OBGYN_HISTORY',
        'blood_group_rh',
      ),
      mirror('summary_lmp', 'LMP', 'lmp'),
      computed('summary_ga_lmp', 'GA (LMP)', 'ga_lmp', 'ga_from_lmp', ['lmp']),
      computed('summary_edd_lmp', 'EDD (LMP)', 'edd_lmp', 'edd_from_lmp', [
        'lmp',
      ]),
      computed('summary_ga_us', 'GA (US)', 'ga_us', 'ga_from_us', [
        'us_dating_date',
        'us_ga_weeks',
        'us_ga_days',
      ]),
      computed('summary_edd_us', 'EDD (US)', 'edd_us', 'edd_from_us', [
        'us_dating_date',
        'us_ga_weeks',
        'us_ga_days',
      ]),
      mirror('summary_type', 'Pregnancy type', 'pregnancy_type', 'SELECT', [
        opt('SINGLETON', 'Singleton'),
        opt('TWINS', 'Twins'),
        opt('TRIPLETS', 'Triplets'),
        opt('HIGHER_ORDER', 'Higher-order'),
      ]),
      mirror('summary_fetuses', 'Number of fetuses', 'number_of_fetuses'),
      display('summary_created', 'Created', 'PREGNANCY_JOURNEY', 'created_at'),
      display('summary_updated', 'Updated', 'PREGNANCY_JOURNEY', 'updated_at'),
      // Episode highlights (live mirrors of the editable Episode fields)
      mirror(
        'summary_anomaly',
        'Anomaly scan',
        'anomaly_scan_result',
        'SELECT',
        [opt('NORMAL', 'Normal'), opt('ABNORMAL', 'Abnormal')],
        4,
      ),
      mirror(
        'summary_gtt',
        'GTT',
        'gtt_interpretation',
        'SELECT',
        [opt('NORMAL', 'Normal'), opt('GDM', 'GDM')],
        4,
      ),
      mirror(
        'summary_trimester',
        'Trimester summary',
        'trimester_summary_notes',
        'TEXT',
        undefined,
        4,
      ),
      // This-visit highlights
      mirror(
        'summary_fundal',
        'Fundal height (this visit)',
        'fundal_height_cm',
        'TEXT',
        undefined,
        4,
      ),
    ],
  },

  // ---------------------------------------------------------------------------
  // 2. Journey — dating & profile (editable). The single LMP capture.
  // ---------------------------------------------------------------------------
  {
    code: 'journey_dating',
    name: 'Dating & profile',
    group: 'Journey',
    fields: [
      {
        code: 'lmp',
        label: 'LMP',
        type: 'DATE',
        binding: { namespace: 'PREGNANCY_JOURNEY', path: 'lmp' },
        config: { ui: { placeholder: '1 / 1 / 2026', colSpan: 4 } },
      },
      {
        code: 'us_dating_date',
        label: 'US dating date',
        type: 'DATE',
        binding: { namespace: 'PREGNANCY_JOURNEY', path: 'us_dating_date' },
        config: { ui: { placeholder: '1 / 1 / 2026', colSpan: 4 } },
      },
      {
        code: 'us_ga_weeks',
        label: 'US GA (weeks)',
        type: 'NUMBER',
        binding: { namespace: 'PREGNANCY_JOURNEY', path: 'us_ga_weeks' },
        config: {
          ui: { placeholder: 'Ex : 6', colSpan: 2, suffix: 'weeks' },
          validation: { min: 0, max: 45 },
        },
      },
      {
        code: 'us_ga_days',
        label: 'US GA (days)',
        type: 'NUMBER',
        binding: { namespace: 'PREGNANCY_JOURNEY', path: 'us_ga_days' },
        config: {
          ui: { placeholder: 'Ex : 3', colSpan: 2, suffix: 'days' },
          validation: { min: 0, max: 6 },
        },
      },
      {
        code: 'risk_level',
        label: 'Risk level',
        type: 'SELECT',
        binding: { namespace: 'PREGNANCY_JOURNEY', path: 'risk_level' },
        config: {
          ui: { placeholder: 'Ex : Normal', colSpan: 4 },
          validation: {
            options: [
              opt('NORMAL', 'Normal'),
              opt('MODERATE', 'Moderate'),
              opt('HIGH', 'High'),
            ],
          },
        },
      },
      {
        code: 'pregnancy_type',
        label: 'Pregnancy type',
        type: 'SELECT',
        binding: { namespace: 'PREGNANCY_JOURNEY', path: 'pregnancy_type' },
        config: {
          ui: { placeholder: 'Ex : Singleton', colSpan: 4 },
          validation: {
            options: [
              opt('SINGLETON', 'Singleton'),
              opt('TWINS', 'Twins'),
              opt('TRIPLETS', 'Triplets'),
              opt('HIGHER_ORDER', 'Higher-order'),
            ],
          },
        },
      },
      {
        // Auto-set from pregnancy_type on the FE (manual for Higher-order).
        code: 'number_of_fetuses',
        label: 'Number of fetuses',
        type: 'NUMBER',
        binding: { namespace: 'PREGNANCY_JOURNEY', path: 'number_of_fetuses' },
        config: {
          ui: { placeholder: 'Ex : 1', colSpan: 4 },
          validation: { min: 1, max: 6 },
        },
      },
      // Read-only GA/EDD shown inline as LMP / US dating are entered (live).
      computed('journey_ga_lmp', 'GA (LMP)', 'ga_lmp', 'ga_from_lmp', ['lmp']),
      computed('journey_edd_lmp', 'EDD (LMP)', 'edd_lmp', 'edd_from_lmp', [
        'lmp',
      ]),
      computed('journey_ga_us', 'GA (US)', 'ga_us', 'ga_from_us', [
        'us_dating_date',
        'us_ga_weeks',
        'us_ga_days',
      ]),
      computed('journey_edd_us', 'EDD (US)', 'edd_us', 'edd_from_us', [
        'us_dating_date',
        'us_ga_weeks',
        'us_ga_days',
      ]),
    ],
  },

  // ---------------------------------------------------------------------------
  // 3. Episode — labs (editable, JSON columns)
  // ---------------------------------------------------------------------------
  {
    code: 'episode_labs',
    name: 'Pregnancy labs',
    group: 'Episode',
    fields: [
      {
        code: 'anomaly_scan_date',
        label: 'Anomaly scan date',
        type: 'DATE',
        binding: { namespace: 'PREGNANCY_EPISODE', path: 'anomaly_scan.date' },
        config: { ui: { colSpan: 4 } },
      },
      {
        code: 'anomaly_scan_result',
        label: 'Anomaly scan result',
        type: 'SELECT',
        binding: {
          namespace: 'PREGNANCY_EPISODE',
          path: 'anomaly_scan.result',
        },
        config: {
          ui: { placeholder: 'Ex : Normal', colSpan: 4 },
          validation: {
            options: [opt('NORMAL', 'Normal'), opt('ABNORMAL', 'Abnormal')],
          },
        },
      },
      {
        code: 'anomaly_scan_notes',
        label: 'Anomaly scan notes',
        type: 'TEXTAREA',
        binding: { namespace: 'PREGNANCY_EPISODE', path: 'anomaly_scan.notes' },
        config: { ui: { colSpan: 4 } },
      },
      {
        code: 'gtt_fasting',
        label: 'GTT fasting',
        type: 'NUMBER',
        binding: { namespace: 'PREGNANCY_EPISODE', path: 'gtt_result.fasting' },
        config: { ui: { colSpan: 3, suffix: 'mmol/L', step: 0.1 } },
      },
      {
        code: 'gtt_one_hour',
        label: 'GTT 1-hour',
        type: 'NUMBER',
        binding: {
          namespace: 'PREGNANCY_EPISODE',
          path: 'gtt_result.one_hour',
        },
        config: { ui: { colSpan: 3, suffix: 'mmol/L', step: 0.1 } },
      },
      {
        code: 'gtt_two_hour',
        label: 'GTT 2-hour',
        type: 'NUMBER',
        binding: {
          namespace: 'PREGNANCY_EPISODE',
          path: 'gtt_result.two_hour',
        },
        config: { ui: { colSpan: 3, suffix: 'mmol/L', step: 0.1 } },
      },
      {
        code: 'gtt_interpretation',
        label: 'GTT interpretation',
        type: 'SELECT',
        binding: {
          namespace: 'PREGNANCY_EPISODE',
          path: 'gtt_result.interpretation',
        },
        config: {
          ui: { placeholder: 'Ex : Normal', colSpan: 3 },
          validation: {
            options: [opt('NORMAL', 'Normal'), opt('GDM', 'GDM')],
          },
        },
      },
      {
        code: 'trimester_summary_notes',
        label: 'Trimester summary',
        type: 'TEXTAREA',
        binding: {
          namespace: 'PREGNANCY_EPISODE',
          path: 'trimester_summary.notes',
        },
        config: { ui: { colSpan: 12 } },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 4. Visit — maternal (editable)
  // ---------------------------------------------------------------------------
  {
    code: 'visit_maternal',
    name: 'Maternal',
    group: 'Visit',
    fields: [
      {
        code: 'cervix_length_mm',
        label: 'Cervix length',
        type: 'NUMBER',
        binding: { namespace: 'PREGNANCY_VISIT', path: 'cervix_length_mm' },
        config: {
          ui: { placeholder: 'Ex : 30', colSpan: 4, suffix: 'mm', step: 0.1 },
          validation: { min: 0, max: 100 },
        },
      },
      {
        code: 'cervix_dilatation_cm',
        label: 'Dilatation',
        type: 'NUMBER',
        binding: { namespace: 'PREGNANCY_VISIT', path: 'cervix_dilatation_cm' },
        config: {
          ui: { placeholder: 'Ex : 2', colSpan: 4, suffix: 'cm', step: 0.1 },
          validation: { min: 0, max: 10 },
        },
      },
      {
        code: 'cervix_effacement_pct',
        label: 'Effacement',
        type: 'NUMBER',
        binding: {
          namespace: 'PREGNANCY_VISIT',
          path: 'cervix_effacement_pct',
        },
        config: {
          ui: { placeholder: 'Ex : 50', colSpan: 4, suffix: '%' },
          validation: { min: 0, max: 100 },
        },
      },
      {
        code: 'cervix_position',
        label: 'Position',
        type: 'SELECT',
        binding: { namespace: 'PREGNANCY_VISIT', path: 'cervix_position' },
        config: {
          ui: { placeholder: 'Ex : Anterior', colSpan: 6 },
          validation: {
            options: [
              opt('ANTERIOR', 'Anterior'),
              opt('MID', 'Mid'),
              opt('POSTERIOR', 'Posterior'),
            ],
          },
        },
      },
      {
        code: 'membranes',
        label: 'Membranes',
        type: 'SELECT',
        binding: { namespace: 'PREGNANCY_VISIT', path: 'membranes' },
        config: {
          ui: { placeholder: 'Ex : Intact', colSpan: 6 },
          validation: {
            options: [opt('INTACT', 'Intact'), opt('RUPTURED', 'Ruptured')],
          },
        },
      },
      {
        code: 'warning_symptoms',
        label: 'Warning symptoms',
        type: 'MULTISELECT',
        binding: { namespace: 'PREGNANCY_VISIT', path: 'warning_symptoms' },
        config: {
          ui: { colSpan: 12 },
          validation: {
            options: [
              opt('SEVERE_HEADACHE', 'Severe headache'),
              opt('VISUAL_DISTURBANCE', 'Visual disturbance'),
              opt('VAGINAL_BLEEDING', 'Vaginal bleeding'),
              opt('EPIGASTRIC_RUQ_PAIN', 'Epigastric / RUQ pain'),
              opt('LEAKAGE_OF_FLUID', 'Leakage of fluid'),
              opt('REDUCED_FETAL_MOVEMENTS', 'Reduced fetal movements'),
              opt('SEVERE_VOMITING', 'Severe vomiting'),
            ],
          },
        },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 5. Visit — fetal (shared, editable)
  // ---------------------------------------------------------------------------
  {
    code: 'visit_fetal',
    name: 'Fetal',
    group: 'Visit',
    fields: [
      {
        code: 'fundal_height_cm',
        label: 'Fundal height',
        type: 'NUMBER',
        binding: { namespace: 'PREGNANCY_VISIT', path: 'fundal_height_cm' },
        config: {
          ui: { placeholder: 'Ex : 30', colSpan: 4, suffix: 'cm', step: 0.1 },
          validation: { min: 0, max: 60 },
        },
      },
      {
        code: 'fundal_corresponds_ga',
        label: 'Corresponds to GA',
        type: 'SELECT',
        binding: {
          namespace: 'PREGNANCY_VISIT',
          path: 'fundal_corresponds_ga',
        },
        config: {
          ui: { placeholder: 'Ex : Yes', colSpan: 4 },
          validation: { options: [opt('YES', 'Yes'), opt('NO', 'No')] },
        },
      },
      {
        code: 'amniotic_fluid',
        label: 'Amniotic fluid',
        type: 'SELECT',
        binding: { namespace: 'PREGNANCY_VISIT', path: 'amniotic_fluid' },
        config: {
          ui: { placeholder: 'Ex : Normal', colSpan: 4 },
          validation: {
            options: [
              opt('NORMAL', 'Normal'),
              opt('OLIGOHYDRAMNIOS', 'Oligohydramnios'),
              opt('POLYHYDRAMNIOS', 'Polyhydramnios'),
            ],
          },
        },
      },
      {
        code: 'placenta_location',
        label: 'Placenta location',
        type: 'SELECT',
        binding: { namespace: 'PREGNANCY_VISIT', path: 'placenta_location' },
        config: {
          ui: { placeholder: 'Ex : Anterior', colSpan: 6 },
          validation: {
            options: [
              opt('ANTERIOR', 'Anterior'),
              opt('POSTERIOR', 'Posterior'),
              opt('FUNDAL', 'Fundal'),
              opt('PREVIA', 'Previa'),
            ],
          },
        },
      },
      {
        code: 'placenta_grade',
        label: 'Placenta grade',
        type: 'NUMBER',
        binding: { namespace: 'PREGNANCY_VISIT', path: 'placenta_grade' },
        config: {
          ui: { placeholder: 'Ex : 0', colSpan: 6 },
          validation: { min: 0, max: 3 },
        },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 6. Fetuses — per-fetus lie + biometrics (REPEATABLE → visit_fetal_records)
  // ---------------------------------------------------------------------------
  {
    code: 'fetuses',
    name: 'Fetus',
    group: 'Visit',
    is_repeatable: true,
    fields: [
      {
        code: 'fetus_label',
        label: 'Label',
        type: 'TEXT',
        binding: { namespace: 'PREGNANCY_FETUS', path: 'fetus_label' },
        config: { ui: { placeholder: 'Ex : Fetus A', colSpan: 4 } },
      },
      {
        code: 'fetus_gender',
        label: 'Gender',
        type: 'SELECT',
        binding: { namespace: 'PREGNANCY_FETUS', path: 'gender' },
        config: {
          ui: { placeholder: 'Ex : Unknown', colSpan: 4 },
          validation: {
            options: [
              opt('MALE', 'Male'),
              opt('FEMALE', 'Female'),
              opt('UNKNOWN', 'Unknown'),
            ],
          },
        },
      },
      {
        code: 'fetal_lie',
        label: 'Lie',
        type: 'SELECT',
        binding: { namespace: 'PREGNANCY_FETUS', path: 'fetal_lie' },
        config: {
          ui: { placeholder: 'Ex : Longitudinal', colSpan: 4 },
          validation: {
            options: [
              opt('LONGITUDINAL', 'Longitudinal'),
              opt('TRANSVERSE', 'Transverse'),
              opt('OBLIQUE', 'Oblique'),
            ],
          },
        },
      },
      {
        code: 'presentation',
        label: 'Presentation',
        type: 'SELECT',
        binding: { namespace: 'PREGNANCY_FETUS', path: 'presentation' },
        config: {
          ui: { placeholder: 'Ex : Cephalic', colSpan: 4 },
          validation: {
            options: [
              opt('CEPHALIC', 'Cephalic'),
              opt('BREECH', 'Breech'),
              opt('SHOULDER', 'Shoulder'),
            ],
          },
        },
      },
      {
        code: 'engagement',
        label: 'Engagement',
        type: 'SELECT',
        binding: { namespace: 'PREGNANCY_FETUS', path: 'engagement' },
        config: {
          ui: { placeholder: 'Ex : Not engaged', colSpan: 4 },
          validation: {
            options: [
              opt('ENGAGED', 'Engaged'),
              opt('NOT_ENGAGED', 'Not engaged'),
            ],
          },
        },
      },
      {
        code: 'fetal_heart_rate_bpm',
        label: 'Heart rate',
        type: 'NUMBER',
        binding: { namespace: 'PREGNANCY_FETUS', path: 'fetal_heart_rate_bpm' },
        config: {
          ui: { placeholder: 'Ex : 140', colSpan: 4, suffix: 'bpm' },
          validation: { min: 0, max: 250 },
        },
      },
      {
        code: 'fetal_rhythm',
        label: 'Rhythm',
        type: 'SELECT',
        binding: { namespace: 'PREGNANCY_FETUS', path: 'fetal_rhythm' },
        config: {
          ui: { placeholder: 'Ex : Regular', colSpan: 4 },
          validation: {
            options: [opt('REGULAR', 'Regular'), opt('IRREGULAR', 'Irregular')],
          },
        },
      },
      {
        code: 'fetal_movements',
        label: 'Movements',
        type: 'SELECT',
        binding: { namespace: 'PREGNANCY_FETUS', path: 'fetal_movements' },
        config: {
          ui: { placeholder: 'Ex : Present', colSpan: 4 },
          validation: {
            options: [
              opt('PRESENT', 'Present'),
              opt('REDUCED', 'Reduced'),
              opt('ABSENT', 'Absent'),
            ],
          },
        },
      },
      {
        code: 'bpd_mm',
        label: 'BPD',
        type: 'NUMBER',
        binding: { namespace: 'PREGNANCY_FETUS', path: 'bpd_mm' },
        config: {
          ui: { placeholder: 'Ex : 90', colSpan: 3, suffix: 'mm', step: 0.1 },
          validation: { min: 0, max: 200 },
        },
      },
      {
        code: 'hc_mm',
        label: 'HC',
        type: 'NUMBER',
        binding: { namespace: 'PREGNANCY_FETUS', path: 'hc_mm' },
        config: {
          ui: { placeholder: 'Ex : 320', colSpan: 3, suffix: 'mm', step: 0.1 },
          validation: { min: 0, max: 500 },
        },
      },
      {
        code: 'ac_mm',
        label: 'AC',
        type: 'NUMBER',
        binding: { namespace: 'PREGNANCY_FETUS', path: 'ac_mm' },
        config: {
          ui: { placeholder: 'Ex : 300', colSpan: 3, suffix: 'mm', step: 0.1 },
          validation: { min: 0, max: 500 },
        },
      },
      {
        code: 'fl_mm',
        label: 'FL',
        type: 'NUMBER',
        binding: { namespace: 'PREGNANCY_FETUS', path: 'fl_mm' },
        config: {
          ui: { placeholder: 'Ex : 65', colSpan: 3, suffix: 'mm', step: 0.1 },
          validation: { min: 0, max: 150 },
        },
      },
      {
        code: 'efw_g',
        label: 'EFW',
        type: 'NUMBER',
        binding: { namespace: 'PREGNANCY_FETUS', path: 'efw_g' },
        config: {
          ui: { placeholder: 'Ex : 1600', colSpan: 4, suffix: 'g', step: 1 },
          validation: { min: 0, max: 7000 },
        },
      },
      {
        code: 'growth_percentile',
        label: 'Growth percentile',
        type: 'NUMBER',
        binding: { namespace: 'PREGNANCY_FETUS', path: 'growth_percentile' },
        config: {
          ui: { placeholder: 'Ex : 50', colSpan: 4, suffix: '%' },
          validation: { min: 0, max: 100 },
        },
      },
      {
        code: 'growth_impression',
        label: 'Growth impression',
        type: 'SELECT',
        binding: { namespace: 'PREGNANCY_FETUS', path: 'growth_impression' },
        config: {
          ui: { placeholder: 'Ex : AGA', colSpan: 4 },
          validation: {
            options: [opt('AGA', 'AGA'), opt('SGA', 'SGA'), opt('LGA', 'LGA')],
          },
        },
      },
    ],
  },
];

function buildSectionConfig(section: SectionSpec): SectionConfig {
  return {
    ui: {
      group: section.group,
      ...(section.readOnly ? { readOnly: true } : {}),
    },
    validation: {},
    logic: {},
  };
}

function assertAllValid(sections: SectionSpec[]): void {
  for (const section of sections) {
    assertValidConfig(buildSectionConfig(section), `section "${section.code}"`);
    for (const field of section.fields) {
      const cfg = field.config ?? {};
      assertValidConfig(cfg, `field "${section.code}.${field.code}"`);
      const descriptor = FIELD_TYPES[field.type];
      if (field.binding?.namespace) {
        if (!descriptor.allowedNamespaces.has(field.binding.namespace)) {
          throw new Error(
            `Field "${section.code}.${field.code}": type ${field.type} does not allow namespace ${field.binding.namespace}`,
          );
        }
        validateBinding(field.binding.namespace, field.binding.path);
      }
      descriptor.assertConfig?.(cfg, `field "${section.code}.${field.code}"`);
    }
  }
}

export async function seedObgynPregnancyTemplate(prisma: PrismaClient) {
  assertAllValid(SECTIONS);

  const gynSpecialty = await prisma.specialty.findUnique({
    where: { code: 'OBGYN' },
  });

  const description =
    'Pregnancy journey clinical surface (OBGYN_PREGNANCY active-journey tab), structured journey → episode → visit and led by a read-only Summary (live GA/EDD, blood group from patient history). Writes via PATCH /visits/:visitId/journeys/:journeyId/clinical. No vitals — the Examination tab is the single source of truth for vitals/complaint/treatment; LMP is captured here, not in the examination menstrual section.';

  const template = await prisma.formTemplate.upsert({
    where: { code_version: { code: TEMPLATE_CODE, version: TEMPLATE_VERSION } },
    update: {
      name: 'OB/GYN Pregnancy',
      description,
      scope: 'ENCOUNTER',
      specialty_id: gynSpecialty?.id ?? null,
      parent_template_id: null,
      extension_key: null,
    },
    create: {
      code: TEMPLATE_CODE,
      version: TEMPLATE_VERSION,
      name: 'OB/GYN Pregnancy',
      description,
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
      where: { code: TEMPLATE_CODE, is_active: true, id: { not: template.id } },
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
