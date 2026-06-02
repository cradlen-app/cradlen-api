/**
 * Medical-rep visit "examination" template seed.
 *
 * Standalone form template (code='medical_rep_visit') driving the editable
 * "Visit" section of the rep-visit workspace. Bindings target the unified bulk
 * `PATCH /v1/medical-rep-visits/:id/examination` (UpdateMedicalRepVisitExaminationDto)
 * via the MEDICAL_REP_VISIT namespace.
 *
 * The read-only rep "Overview" (name, company, specialty focus, last visit,
 * medicines promoted) is rendered by the frontend from the GET envelope — it is
 * NOT part of this template.
 *
 * "Products discussed" is intentionally NOT a template field — it's a bespoke
 * search/chips picker in the rep-visit workspace (catalog search + create-new +
 * auto-promote to the rep's medicines), sent as `products[]` on the same PATCH.
 *
 * Activation: ends with a $transaction that deactivates prior active rows for
 * code='medical_rep_visit' and flips this one to active + PUBLISHED. Idempotent
 * (upsert by (code, version)).
 */

import { BindingNamespace, PrismaClient } from '@prisma/client';
import { validateBinding } from '../../src/builder/fields/allowed-paths.js';
import { assertValidConfig } from '../../src/builder/fields/field-config.schema.js';
import { FIELD_TYPES } from '../../src/builder/fields/field-type.registry.js';

const TEMPLATE_CODE = 'medical_rep_visit';
const TEMPLATE_VERSION = 2;

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
  fields: FieldSpec[];
}

const opt = (code: string, label: string) => ({ code, label });

const SECTIONS: SectionSpec[] = [
  {
    code: 'visit',
    name: 'Visit',
    fields: [
      {
        code: 'purpose',
        label: 'Purpose of visit',
        type: 'SELECT',
        binding: { namespace: 'MEDICAL_REP_VISIT', path: 'purpose' },
        config: {
          ui: { placeholder: 'Ex : Product detailing', colSpan: 4 },
          validation: {
            options: [
              opt('PRODUCT_DETAILING', 'Product detailing'),
              opt('SAMPLE_DROP', 'Sample drop-off'),
              opt('CONFERENCE_INVITE', 'Conference / event invite'),
              opt('PRICE_UPDATE', 'Price / formulary update'),
              opt('FOLLOW_UP', 'Follow-up'),
              opt('COURTESY', 'Courtesy'),
              opt('OTHER', 'Other'),
            ],
          },
        },
      },
      {
        code: 'samples_received',
        label: 'Samples received',
        type: 'BOOLEAN',
        binding: {
          namespace: 'MEDICAL_REP_VISIT',
          path: 'samples_received',
        },
        config: { ui: { colSpan: 4 } },
      },
      {
        code: 'follow_up_date',
        label: 'Follow-up date',
        type: 'DATE',
        binding: { namespace: 'MEDICAL_REP_VISIT', path: 'follow_up_date' },
        config: { ui: { colSpan: 4 } },
      },
      // "Products discussed" is NOT a template field — it's a bespoke search/chips
      // picker in the rep visit workspace (catalog search + create-new + auto-promote
      // to the rep's medicines), sent as `products[]` on the same examination PATCH.
      {
        code: 'outcome',
        label: 'Outcome / next step',
        type: 'SELECT',
        binding: { namespace: 'MEDICAL_REP_VISIT', path: 'outcome' },
        config: {
          ui: { placeholder: 'Ex : Schedule follow-up', colSpan: 6 },
          validation: {
            options: [
              opt('NONE', 'None'),
              opt('SCHEDULE_FOLLOWUP', 'Schedule follow-up'),
              opt('SHARE_MATERIALS', 'Share materials'),
              opt('NOT_INTERESTED', 'Not interested'),
            ],
          },
        },
      },
      {
        code: 'notes',
        label: 'Notes',
        type: 'TEXTAREA',
        binding: { namespace: 'MEDICAL_REP_VISIT', path: 'notes' },
        config: { ui: { placeholder: 'Visit notes', colSpan: 12 } },
      },
    ],
  },
];

function buildSectionConfig(_section: SectionSpec): any {
  return { ui: {}, validation: {}, logic: {} };
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

export async function seedMedicalRepVisitTemplate(prisma: PrismaClient) {
  assertAllValid();

  const template = await prisma.formTemplate.upsert({
    where: {
      code_version: { code: TEMPLATE_CODE, version: TEMPLATE_VERSION },
    },
    update: {
      name: 'Medical Rep Visit',
      description:
        'Editable Visit section of the medical-rep visit workspace (purpose, products discussed, samples received, outcome, follow-up date, notes). Writes via the unified bulk PATCH /medical-rep-visits/:id/examination.',
      scope: 'ENCOUNTER',
      specialty_id: null,
      parent_template_id: null,
      extension_key: null,
    },
    create: {
      code: TEMPLATE_CODE,
      version: TEMPLATE_VERSION,
      name: 'Medical Rep Visit',
      description:
        'Editable Visit section of the medical-rep visit workspace (purpose, products discussed, samples received, outcome, follow-up date, notes). Writes via the unified bulk PATCH /medical-rep-visits/:id/examination.',
      scope: 'ENCOUNTER',
      status: 'DRAFT',
      specialty_id: null,
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
        is_repeatable: false,
        config: buildSectionConfig(sectionSpec),
      },
      create: {
        form_template_id: template.id,
        code: sectionSpec.code,
        name: sectionSpec.name,
        order: i,
        is_repeatable: false,
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
