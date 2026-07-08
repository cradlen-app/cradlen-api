/**
 * OB/GYN Surgical clinical-surface template seed (code='obgyn_surgical').
 *
 * Backs the dynamic "Surgical" tab the OBGYN_SURGICAL care path declares — the
 * second live journey clinical surface (after pregnancy). Same flat-envelope /
 * namespace-demux model as obgyn_pregnancy: journey → episode → visit, led by a
 * READ-ONLY Summary.
 *
 *   - Summary (read-only, NOT submitted) — status (editable SELECT → outcome
 *     drawer via the `surgical-status` variant), plus live mirrors of the
 *     editable profile/operative fields. The cross-journey context (the source
 *     pregnancy summary for a cesarean, else the patient history summary) is
 *     folded into the GET envelope by the service and rendered by the FE — it is
 *     not a bound template field (COMPUTED requires an FE formula).
 *   - Journey — surgery profile (editable): procedure (ENTITY_SEARCH →
 *     Procedure catalog), indication, urgency, anesthesia, planned/surgery date
 *     → SURGICAL_JOURNEY.
 *   - Pre-operative / Operative / Post-operative — three collapsible phase
 *     sections (editable) → SURGICAL_EPISODE. Each phase's blob lives on its own
 *     phase-episode record (pre-op → order-1, operative → order-2, post-op →
 *     order-3); the service aggregates all three so every field pre-fills from
 *     any visit. The operative note is singular per journey (not per-visit).
 *   - This visit (follow-up) — the per-encounter post-op entry (interval
 *     history, wound assessment this visit, plan) → SURGICAL_VISIT.
 *
 * Activation flips this template active + PUBLISHED. Idempotent.
 */

import { BindingNamespace, PrismaClient } from '@prisma/client';
import { validateBinding } from '../../src/builder/fields/allowed-paths.js';
import { assertValidConfig } from '../../src/builder/fields/field-config.schema.js';
import { FIELD_TYPES } from '../../src/builder/fields/field-type.registry.js';

const TEMPLATE_CODE = 'obgyn_surgical';
const TEMPLATE_VERSION = 2;

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
  /** FE renders a collapse chevron; the current phase is expanded by default. */
  collapsible?: boolean;
  /** Phase episode order (1=Pre-op, 2=Operative, 3=Post-op) — drives which
   *  collapsible section the FE auto-expands for the visit's current phase. */
  phaseOrder?: number;
  fields: FieldSpec[];
}

const opt = (code: string, label: string) => ({ code, label });

const URGENCY_OPTS = [
  opt('ELECTIVE', 'Elective'),
  opt('URGENT', 'Urgent'),
  opt('EMERGENCY', 'Emergency'),
];
const ANESTHESIA_OPTS = [
  opt('GENERAL', 'General'),
  opt('REGIONAL', 'Regional'),
  opt('LOCAL', 'Local'),
  opt('SEDATION', 'Sedation'),
];
const ASA_OPTS = [
  opt('ASA_I', 'ASA I'),
  opt('ASA_II', 'ASA II'),
  opt('ASA_III', 'ASA III'),
  opt('ASA_IV', 'ASA IV'),
  opt('ASA_V', 'ASA V'),
];
const CLEARANCE_OPTS = [
  opt('CLEARED', 'Cleared'),
  opt('CONDITIONAL', 'Conditional'),
  opt('NOT_CLEARED', 'Not cleared'),
];
const YES_NO_OPTS = [opt('YES', 'Yes'), opt('NO', 'No')];
const CONSENT_OPTS = [opt('OBTAINED', 'Obtained'), opt('PENDING', 'Pending')];
const WOUND_OPTS = [
  opt('CLEAN_DRY', 'Clean & dry'),
  opt('ERYTHEMA', 'Erythema'),
  opt('DISCHARGE', 'Discharge'),
  opt('DEHISCENCE', 'Dehiscence'),
];
const COMPLICATION_OPTS = [
  opt('NONE', 'None'),
  opt('BLEEDING', 'Bleeding / hemorrhage'),
  opt('INFECTION', 'Infection'),
  opt('ANESTHETIC', 'Anesthetic complication'),
  opt('ORGAN_INJURY', 'Organ injury'),
  opt('THROMBOEMBOLIC', 'Thromboembolic'),
];
const SAFETY_SIGNIN_OPTS = [
  opt('IDENTITY_CONFIRMED', 'Patient identity confirmed'),
  opt('SITE_MARKED', 'Surgical site marked'),
  opt('CONSENT_CONFIRMED', 'Consent confirmed'),
  opt('ANESTHESIA_CHECK', 'Anesthesia safety check complete'),
  opt('ALLERGY_CHECKED', 'Known allergy reviewed'),
  opt('AIRWAY_RISK', 'Difficult airway / aspiration risk assessed'),
];
const DISCHARGE_OPTS = [
  opt('PENDING', 'Pending'),
  opt('DISCHARGED', 'Discharged'),
  opt('ADMITTED', 'Admitted / observation'),
  opt('TRANSFERRED', 'Transferred'),
];
// Blood group / Rh — copied verbatim from the OB/GYN patient-history seed
// (`general_medical` section). Codes match the `BloodGroupRh` Prisma enum;
// negative labels use the Unicode minus sign (U+2212).
const BLOOD_GROUP_OPTS = [
  opt('A_POS', 'A+'),
  opt('A_NEG', 'A−'),
  opt('B_POS', 'B+'),
  opt('B_NEG', 'B−'),
  opt('AB_POS', 'AB+'),
  opt('AB_NEG', 'AB−'),
  opt('O_POS', 'O+'),
  opt('O_NEG', 'O−'),
];

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
  // 1. Summary — read-only overview (journey + phases + this-visit). Not submitted.
  // ---------------------------------------------------------------------------
  {
    code: 'summary',
    name: 'Surgical summary',
    group: 'Summary',
    readOnly: true,
    fields: [
      {
        // Editable status: choosing "Closed" opens the outcome drawer (custom
        // input). Binds the journey status so its value hydrates from the GET.
        code: 'status',
        label: 'Status',
        type: 'SELECT',
        binding: { namespace: 'SURGICAL_JOURNEY', path: 'status' },
        config: {
          ui: { variant: 'surgical-status', colSpan: 3 },
          validation: {
            options: [opt('ACTIVE', 'Active'), opt('CLOSED', 'Closed')],
          },
        },
      },
      mirror('summary_procedure', 'Procedure', 'procedure_name', 'TEXT', undefined, 4),
      mirror('summary_urgency', 'Urgency', 'urgency', 'SELECT', URGENCY_OPTS),
      mirror('summary_anesthesia', 'Anesthesia', 'anesthesia_type', 'SELECT', ANESTHESIA_OPTS),
      mirror('summary_planned', 'Planned date', 'planned_date'),
      mirror('summary_surgery', 'Surgery date', 'surgery_date'),
      // Blood group — live mirror of the editable SELECT in the Surgery profile
      // (which writes through to the patient's OB/GYN history).
      mirror('summary_blood_group', 'Blood group', 'blood_group_rh', 'SELECT', BLOOD_GROUP_OPTS),
      mirror('summary_indication', 'Indication', 'indication', 'TEXT', undefined, 9),
      display('summary_created', 'Created', 'SURGICAL_JOURNEY', 'created_at'),
      display('summary_updated', 'Updated', 'SURGICAL_JOURNEY', 'updated_at'),
      // This-visit follow-up highlights (live mirrors of the editable Visit fields)
      mirror('summary_wound', 'Wound status (this visit)', 'wound_status', 'SELECT', WOUND_OPTS, 6),
      mirror('summary_interval', 'Interval history (this visit)', 'interval_history', 'TEXT', undefined, 6),
    ],
  },

  // ---------------------------------------------------------------------------
  // 2. Journey — surgery profile (editable).
  // ---------------------------------------------------------------------------
  {
    code: 'journey_profile',
    name: 'Surgery profile',
    group: 'Journey',
    fields: [
      {
        code: 'procedure_name',
        label: 'Procedure',
        type: 'ENTITY_SEARCH',
        binding: { namespace: 'SURGICAL_JOURNEY', path: 'procedure_name' },
        config: {
          ui: {
            placeholder: 'Search procedure by name or code',
            colSpan: 6,
            searchEntity: {
              kind: 'procedure',
              // On pick, copy the resolved Procedure id + code into the hidden
              // sibling fields; allowCreate keeps free-typed procedure names.
              idTarget: 'procedure_id',
              fillFields: { procedure_code: 'code' },
              allowCreate: true,
            },
          },
          logic: { entity: 'procedure' },
        },
      },
      {
        // Hidden sibling — receives the resolved Procedure id when a catalog
        // procedure is picked (idTarget of procedure_name). Free text leaves it
        // empty; procedure_name carries the label.
        code: 'procedure_id',
        label: 'Procedure id',
        type: 'TEXT',
        binding: { namespace: 'SURGICAL_JOURNEY', path: 'procedure_id' },
        config: { ui: { hidden: true } },
      },
      {
        code: 'procedure_code',
        label: 'Procedure code',
        type: 'TEXT',
        binding: { namespace: 'SURGICAL_JOURNEY', path: 'procedure_code' },
        config: { ui: { readOnly: true, colSpan: 6 } },
      },
      {
        // Patient-level blood group — editable here (the surgical tab does not
        // surface the general medical-history section). Writes through to
        // PatientObgynHistory.blood_group_rh (single source of truth) via the
        // surgical PATCH; the read-only Summary mirrors it.
        code: 'blood_group_rh',
        label: 'Blood group / Rh',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'blood_group_rh',
        },
        config: {
          ui: { placeholder: 'Ex : O+', colSpan: 4 },
          validation: { options: BLOOD_GROUP_OPTS },
        },
      },
      {
        code: 'urgency',
        label: 'Urgency',
        type: 'SELECT',
        binding: { namespace: 'SURGICAL_JOURNEY', path: 'urgency' },
        config: {
          ui: { placeholder: 'Ex : Elective', colSpan: 4 },
          validation: { options: URGENCY_OPTS },
        },
      },
      {
        code: 'anesthesia_type',
        label: 'Anesthesia',
        type: 'SELECT',
        binding: { namespace: 'SURGICAL_JOURNEY', path: 'anesthesia_type' },
        config: {
          ui: { placeholder: 'Ex : General', colSpan: 4 },
          validation: { options: ANESTHESIA_OPTS },
        },
      },
      {
        code: 'planned_date',
        label: 'Planned date',
        type: 'DATE',
        binding: { namespace: 'SURGICAL_JOURNEY', path: 'planned_date' },
        config: { ui: { placeholder: '1 / 1 / 2026', colSpan: 4 } },
      },
      {
        code: 'surgery_date',
        label: 'Surgery date',
        type: 'DATE',
        binding: { namespace: 'SURGICAL_JOURNEY', path: 'surgery_date' },
        config: { ui: { placeholder: '1 / 1 / 2026', colSpan: 4 } },
      },
      {
        code: 'indication',
        label: 'Indication',
        type: 'TEXTAREA',
        binding: { namespace: 'SURGICAL_JOURNEY', path: 'indication' },
        config: { ui: { placeholder: 'Reason for surgery', colSpan: 12 } },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 3. Pre-operative (Episode 1) — assessment only, NO operative fields.
  //    Stored on the order-1 phase-episode record (preop_assessment JSON).
  // ---------------------------------------------------------------------------
  {
    code: 'episode_preop',
    name: 'Pre-operative',
    group: 'Episode',
    collapsible: true,
    phaseOrder: 1,
    fields: [
      {
        code: 'preop_asa_class',
        label: 'ASA class',
        type: 'SELECT',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'preop_assessment.asa_class',
        },
        config: {
          ui: { placeholder: 'Ex : ASA II', colSpan: 4 },
          validation: { options: ASA_OPTS },
        },
      },
      {
        code: 'preop_clearance',
        label: 'Clearance',
        type: 'SELECT',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'preop_assessment.clearance',
        },
        config: {
          ui: { placeholder: 'Ex : Cleared', colSpan: 4 },
          validation: { options: CLEARANCE_OPTS },
        },
      },
      {
        code: 'preop_fasting_status',
        label: 'Fasting status',
        type: 'SELECT',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'preop_assessment.fasting_status',
        },
        config: {
          ui: { placeholder: 'Ex : Yes', colSpan: 4 },
          validation: { options: YES_NO_OPTS },
        },
      },
      {
        code: 'preop_consent',
        label: 'Consent',
        type: 'SELECT',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'preop_assessment.consent_obtained',
        },
        config: {
          ui: { placeholder: 'Ex : Obtained', colSpan: 4 },
          validation: { options: CONSENT_OPTS },
        },
      },
      {
        code: 'preop_consent_details',
        label: 'Consent details',
        type: 'TEXTAREA',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'preop_assessment.consent_details',
        },
        config: {
          ui: {
            placeholder: 'Procedure explained, risks/benefits, alternatives, who consented',
            colSpan: 8,
          },
        },
      },
      {
        code: 'preop_investigations',
        label: 'Pre-op investigations',
        type: 'TEXTAREA',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'preop_assessment.pre_op_investigations',
        },
        config: {
          ui: { placeholder: 'CBC, coagulation, imaging, cross-match, ECG…', colSpan: 12 },
        },
      },
      {
        code: 'preop_safety_checklist',
        label: 'Surgical safety checklist (sign-in)',
        type: 'MULTISELECT',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'preop_assessment.safety_checklist_signin',
        },
        config: { ui: { colSpan: 12 }, validation: { options: SAFETY_SIGNIN_OPTS } },
      },
      {
        code: 'preop_notes',
        label: 'Pre-op notes',
        type: 'TEXTAREA',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'preop_assessment.notes',
        },
        config: { ui: { colSpan: 12 } },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 4. Operative (Episode 2) — the ONLY place with operative fields.
  //    Stored on the order-2 phase-episode record (operative_summary JSON) —
  //    singular per journey, visible from any visit.
  // ---------------------------------------------------------------------------
  {
    code: 'episode_operative',
    name: 'Operative',
    group: 'Episode',
    collapsible: true,
    phaseOrder: 2,
    fields: [
      {
        code: 'op_procedure_performed',
        label: 'Procedure performed',
        type: 'TEXT',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'operative_summary.procedure_performed',
        },
        config: { ui: { placeholder: 'Ex : Laparoscopic left ovarian cystectomy', colSpan: 8 } },
      },
      {
        code: 'op_ebl_ml',
        label: 'Estimated blood loss',
        type: 'NUMBER',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'operative_summary.ebl_ml',
        },
        config: {
          ui: { placeholder: 'Ex : 400', colSpan: 4, suffix: 'mL' },
          validation: { min: 0, max: 10000 },
        },
      },
      {
        code: 'op_duration_minutes',
        label: 'Duration',
        type: 'NUMBER',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'operative_summary.duration_minutes',
        },
        config: {
          ui: { placeholder: 'Ex : 45', colSpan: 4, suffix: 'min' },
          validation: { min: 0, max: 1440 },
        },
      },
      {
        code: 'op_drains',
        label: 'Drains',
        type: 'TEXT',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'operative_summary.drains',
        },
        config: { ui: { placeholder: 'Ex : None', colSpan: 4 } },
      },
      {
        code: 'op_specimens_sent',
        label: 'Specimens sent',
        type: 'TEXT',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'operative_summary.specimens_sent',
        },
        config: { ui: { placeholder: 'Ex : Left ovarian cyst → histology', colSpan: 4 } },
      },
      {
        code: 'op_complications',
        label: 'Complications',
        type: 'MULTISELECT',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'operative_summary.complications',
        },
        config: { ui: { colSpan: 12 }, validation: { options: COMPLICATION_OPTS } },
      },
      {
        code: 'op_findings',
        label: 'Operative findings',
        type: 'TEXTAREA',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'operative_summary.findings',
        },
        config: { ui: { colSpan: 12 } },
      },
      {
        code: 'op_time_out_completed',
        label: 'Time-out completed',
        type: 'BOOLEAN',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'operative_summary.time_out_completed',
        },
        config: { ui: { colSpan: 6 } },
      },
      {
        code: 'op_sign_out_completed',
        label: 'Sign-out completed',
        type: 'BOOLEAN',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'operative_summary.sign_out_completed',
        },
        config: { ui: { colSpan: 6 } },
      },
      {
        code: 'op_immediate_postop',
        label: 'Immediate post-op',
        type: 'TEXTAREA',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'operative_summary.immediate_postop',
        },
        config: {
          ui: { placeholder: 'Recovery-room status, vitals, analgesia, disposition', colSpan: 12 },
        },
      },
      {
        code: 'op_notes',
        label: 'Operative note',
        type: 'TEXTAREA',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'operative_summary.notes',
        },
        config: { ui: { colSpan: 12 } },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 5. Post-operative (Episode 3) — episode-level recovery; NO operative note.
  //    Stored on the order-3 phase-episode record (postop_summary JSON).
  //    Per-follow-up interval history / wound live in "This visit" below.
  // ---------------------------------------------------------------------------
  {
    code: 'episode_postop',
    name: 'Post-operative',
    group: 'Episode',
    collapsible: true,
    phaseOrder: 3,
    fields: [
      {
        code: 'postop_histopathology',
        label: 'Histopathology result review',
        type: 'TEXTAREA',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'postop_summary.histopathology_result',
        },
        config: { ui: { placeholder: 'Specimen, diagnosis, margins, action', colSpan: 12 } },
      },
      {
        code: 'postop_recovery_milestones',
        label: 'Recovery milestones',
        type: 'TEXTAREA',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'postop_summary.recovery_milestones',
        },
        config: {
          ui: { placeholder: 'Ambulation, oral intake, bowel function, suture removal…', colSpan: 12 },
        },
      },
      {
        code: 'postop_discharge_decision',
        label: 'Discharge decision',
        type: 'SELECT',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'postop_summary.discharge_decision',
        },
        config: {
          ui: { placeholder: 'Ex : Discharged', colSpan: 6 },
          validation: { options: DISCHARGE_OPTS },
        },
      },
      {
        code: 'postop_discharge_date',
        label: 'Discharge date',
        type: 'DATE',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'postop_summary.discharge_date',
        },
        config: { ui: { colSpan: 6 } },
      },
      {
        code: 'postop_notes',
        label: 'Post-operative summary',
        type: 'TEXTAREA',
        binding: {
          namespace: 'SURGICAL_EPISODE',
          path: 'postop_summary.notes',
        },
        config: { ui: { colSpan: 12 } },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 6. This visit (follow-up) — per-encounter post-op entry (current visit only).
  //    Stored on the per-visit record (SURGICAL_VISIT).
  // ---------------------------------------------------------------------------
  {
    code: 'visit_followup',
    name: 'This visit (follow-up)',
    group: 'Visit',
    fields: [
      {
        code: 'interval_history',
        label: 'Interval history',
        type: 'TEXTAREA',
        binding: { namespace: 'SURGICAL_VISIT', path: 'interval_history' },
        config: { ui: { placeholder: 'Symptoms/events since the last visit', colSpan: 12 } },
      },
      {
        code: 'wound_assessment',
        label: 'Wound assessment',
        type: 'TEXTAREA',
        binding: { namespace: 'SURGICAL_VISIT', path: 'wound_assessment' },
        config: { ui: { placeholder: 'Site, healing, signs of infection', colSpan: 8 } },
      },
      {
        code: 'wound_status',
        label: 'Wound status',
        type: 'SELECT',
        binding: { namespace: 'SURGICAL_VISIT', path: 'wound_status' },
        config: {
          ui: { placeholder: 'Ex : Clean & dry', colSpan: 4 },
          validation: { options: WOUND_OPTS },
        },
      },
      {
        code: 'plan',
        label: 'Plan',
        type: 'TEXTAREA',
        binding: { namespace: 'SURGICAL_VISIT', path: 'plan' },
        config: { ui: { placeholder: 'Next steps, follow-up interval, referrals', colSpan: 12 } },
      },
      {
        code: 'recovery_notes',
        label: 'Recovery notes',
        type: 'TEXTAREA',
        binding: { namespace: 'SURGICAL_VISIT', path: 'recovery_notes' },
        config: { ui: { colSpan: 12 } },
      },
    ],
  },
];

function buildSectionConfig(section: SectionSpec): SectionConfig {
  return {
    ui: {
      group: section.group,
      ...(section.readOnly ? { readOnly: true } : {}),
      ...(section.collapsible ? { collapsible: true } : {}),
      ...(section.phaseOrder != null ? { phaseOrder: section.phaseOrder } : {}),
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

export async function seedObgynSurgicalTemplate(prisma: PrismaClient) {
  assertAllValid(SECTIONS);

  const gynSpecialty = await prisma.specialty.findUnique({
    where: { code: 'OBGYN' },
  });

  const description =
    'Surgical journey clinical surface (OBGYN_SURGICAL active-journey tab), structured journey → episode → visit and led by a read-only Summary. Surgery type resolves against the Procedure catalog; a cesarean folds the source pregnancy summary into the GET envelope. Writes via PATCH /visits/:visitId/journeys/:journeyId/clinical. No vitals — the Examination tab is the single source of truth for vitals/complaint/treatment.';

  const template = await prisma.formTemplate.upsert({
    where: { code_version: { code: TEMPLATE_CODE, version: TEMPLATE_VERSION } },
    update: {
      name: 'OB/GYN Surgical',
      description,
      scope: 'ENCOUNTER',
      specialty_id: gynSpecialty?.id ?? null,
      parent_template_id: null,
      extension_key: null,
    },
    create: {
      code: TEMPLATE_CODE,
      version: TEMPLATE_VERSION,
      name: 'OB/GYN Surgical',
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
