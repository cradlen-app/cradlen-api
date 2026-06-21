/**
 * OB/GYN Pregnancy clinical-surface template seed (code='obgyn_pregnancy').
 *
 * Backs the dynamic "Pregnancy" tab the OBGYN_PREGNANCY care path declares
 * (CarePathClinicalSurface). The generic JourneyClinicalFormShell renders it and
 * submits a FLAT body keyed by binding path; the pregnancy-clinical PATCH demuxes
 * each field into its scoped record:
 *
 *   - PREGNANCY_JOURNEY → pregnancy_journey_records (profile + snapshot)
 *   - PREGNANCY_EPISODE → pregnancy_episode_records (JSON labs)
 *   - PREGNANCY_VISIT   → visit_pregnancy_records   (maternal + shared fetal)
 *   - PREGNANCY_FETUS   → visit_fetal_records       (repeatable, per fetus)
 *   - COMPUTED          → server-computed GA/EDD (read-only; never submitted)
 *
 * Vitals are intentionally absent — the Examination tab stays the single source
 * of truth for vitals (and complaint/treatment). Activation flips this template
 * active + PUBLISHED. Idempotent (upsert by (code, version)).
 */

import { BindingNamespace, PrismaClient } from '@prisma/client';
import { validateBinding } from '../../src/builder/fields/allowed-paths.js';
import { assertValidConfig } from '../../src/builder/fields/field-config.schema.js';
import { FIELD_TYPES } from '../../src/builder/fields/field-type.registry.js';

const TEMPLATE_CODE = 'obgyn_pregnancy';
const TEMPLATE_VERSION = 1;

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
  fields: FieldSpec[];
}

const opt = (code: string, label: string) => ({ code, label });

/** A read-only display field (server-owned value shown verbatim). */
const display = (
  code: string,
  label: string,
  namespace: BindingNamespace,
  path: string,
  colSpan = 4,
): FieldSpec => ({
  code,
  label,
  type: 'TEXT',
  binding: { namespace, path },
  config: { ui: { readOnly: true, colSpan } },
});

const SECTIONS: SectionSpec[] = [
  // ---------------------------------------------------------------------------
  // Pregnancy profile (read-only lifecycle)
  // ---------------------------------------------------------------------------
  {
    code: 'pregnancy_profile',
    name: 'Pregnancy profile',
    group: 'Pregnancy profile',
    fields: [
      display('profile_status', 'Profile status', 'PREGNANCY_JOURNEY', 'status'),
      display('profile_created_at', 'Created at', 'PREGNANCY_JOURNEY', 'created_at'),
      display('profile_updated_at', 'Updated at', 'PREGNANCY_JOURNEY', 'updated_at'),
    ],
  },

  // ---------------------------------------------------------------------------
  // Pregnancy snapshot (journey scope + computed GA/EDD)
  // ---------------------------------------------------------------------------
  {
    code: 'pregnancy_snapshot',
    name: 'Pregnancy snapshot',
    group: 'Pregnancy snapshot',
    fields: [
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
        code: 'lmp',
        label: 'LMP',
        type: 'DATE',
        binding: { namespace: 'PREGNANCY_JOURNEY', path: 'lmp' },
        config: { ui: { placeholder: '1 / 1 / 2026', colSpan: 4 } },
      },
      {
        code: 'blood_group_rh',
        label: 'Blood group & RH',
        type: 'TEXT',
        binding: { namespace: 'PREGNANCY_JOURNEY', path: 'blood_group_rh' },
        config: { ui: { placeholder: 'Ex : A+', colSpan: 4 } },
      },
      display('ga_lmp', 'Gestational age (LMP)', 'COMPUTED', 'ga_lmp'),
      display('edd_lmp', 'EDD (LMP)', 'COMPUTED', 'edd_lmp'),
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
          ui: { placeholder: 'Ex : 6', colSpan: 2, suffix: 'days' },
          validation: { min: 0, max: 6 },
        },
      },
      display('ga_us', 'Gestational age (US)', 'COMPUTED', 'ga_us'),
      display('edd_us', 'EDD (US)', 'COMPUTED', 'edd_us'),
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
            ],
          },
        },
      },
      {
        code: 'number_of_fetuses',
        label: 'Number of fetuses',
        type: 'NUMBER',
        binding: { namespace: 'PREGNANCY_JOURNEY', path: 'number_of_fetuses' },
        config: {
          ui: { placeholder: 'Ex : 1', colSpan: 4 },
          validation: { min: 1, max: 6 },
        },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Maternal — Cervix (per-visit)
  // ---------------------------------------------------------------------------
  {
    code: 'maternal_cervix',
    name: 'Cervix',
    group: 'Maternal',
    fields: [
      {
        code: 'cervix_length_mm',
        label: 'Length',
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
        binding: { namespace: 'PREGNANCY_VISIT', path: 'cervix_effacement_pct' },
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
    ],
  },

  // ---------------------------------------------------------------------------
  // Maternal — Pregnancy Warning Symptoms (per-visit, multi-select)
  // ---------------------------------------------------------------------------
  {
    code: 'maternal_warning_symptoms',
    name: 'Pregnancy Warning Symptoms',
    group: 'Maternal',
    fields: [
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
  // Fetal — Fundal (per-visit, shared across fetuses)
  // ---------------------------------------------------------------------------
  {
    code: 'fetal_fundal',
    name: 'Fundal',
    group: 'Fetal',
    fields: [
      {
        code: 'fundal_height_cm',
        label: 'Fundal height',
        type: 'NUMBER',
        binding: { namespace: 'PREGNANCY_VISIT', path: 'fundal_height_cm' },
        config: {
          ui: { placeholder: 'Ex : 30', colSpan: 6, suffix: 'cm', step: 0.1 },
          validation: { min: 0, max: 60 },
        },
      },
      {
        code: 'fundal_corresponds_ga',
        label: 'Corresponds to GA',
        type: 'SELECT',
        binding: { namespace: 'PREGNANCY_VISIT', path: 'fundal_corresponds_ga' },
        config: {
          ui: { placeholder: 'Ex : Yes', colSpan: 6 },
          validation: { options: [opt('YES', 'Yes'), opt('NO', 'No')] },
        },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Fetal — Amniotic & Placenta (per-visit, shared)
  // ---------------------------------------------------------------------------
  {
    code: 'fetal_amniotic_placenta',
    name: 'Amniotic & Placenta',
    group: 'Fetal',
    fields: [
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
          ui: { placeholder: 'Ex : Anterior', colSpan: 4 },
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
          ui: { placeholder: 'Ex : 0', colSpan: 4 },
          validation: { min: 0, max: 3 },
        },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Fetuses — per-fetus lie + biometrics (REPEATABLE → visit_fetal_records)
  // Section code 'fetuses' = the body array key the diff consumes.
  // ---------------------------------------------------------------------------
  {
    code: 'fetuses',
    name: 'Fetus',
    group: 'Fetal',
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
            options: [
              opt('AGA', 'AGA'),
              opt('SGA', 'SGA'),
              opt('LGA', 'LGA'),
            ],
          },
        },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Pregnancy labs (episode scope — JSON columns)
  // ---------------------------------------------------------------------------
  {
    code: 'pregnancy_labs',
    name: 'Pregnancy labs',
    group: 'Labs',
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
        binding: { namespace: 'PREGNANCY_EPISODE', path: 'anomaly_scan.result' },
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
        binding: { namespace: 'PREGNANCY_EPISODE', path: 'gtt_result.one_hour' },
        config: { ui: { colSpan: 3, suffix: 'mmol/L', step: 0.1 } },
      },
      {
        code: 'gtt_two_hour',
        label: 'GTT 2-hour',
        type: 'NUMBER',
        binding: { namespace: 'PREGNANCY_EPISODE', path: 'gtt_result.two_hour' },
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
];

function buildSectionConfig(section: SectionSpec): SectionConfig {
  return { ui: { group: section.group }, validation: {}, logic: {} };
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
    'Pregnancy journey clinical surface (active-journey tab for the OBGYN_PREGNANCY care path): profile + snapshot (computed GA/EDD) + maternal (cervix, warning symptoms) + fetal (fundal, amniotic/placenta, repeatable per-fetus biometrics) + episode labs. Writes via PATCH /visits/:visitId/journeys/:journeyId/clinical. No vitals — the Examination tab is the single source of truth for vitals/complaint/treatment.';

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
