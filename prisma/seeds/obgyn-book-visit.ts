/**
 * OB/GYN Book-Visit extension seed.
 *
 * Contributes the OB/GYN-specific clinical intake section that composes onto
 * the generic `book_visit` shell when fetched via
 * `GET /v1/form-templates/book_visit?extension=OBGYN`.
 *
 * Every field is auto-emitted with a `forbidden when specialty_code != OBGYN`
 * predicate so the server rejects OB/GYN fields submitted under a different
 * specialty even if the client sends them.
 *
 * Returns the upserted extension row (NOT activated here — activation is
 * bundled by the orchestrator seed in `book-visit.ts`).
 */

import { FormTemplate, PrismaClient } from '@prisma/client';
import { validateBinding } from '../../src/builder/fields/allowed-paths.js';
import { assertValidConfig } from '../../src/builder/fields/field-config.schema.js';
import { FIELD_TYPES } from '../../src/builder/fields/field-type.registry.js';
import type { Predicate } from '../../src/builder/rules/predicates.js';

const TEMPLATE_CODE = 'obgyn_book_visit_ext';
const TEMPLATE_VERSION = 1;
const EXTENSION_KEY = 'OBGYN';

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
  visibleWhen?: { eq: Record<string, unknown> };
  exclusivityKey?: { field: string; thisValue: string; otherValues: string[] };
  fields: FieldSpec[];
}

const SECTIONS: SectionSpec[] = [
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
];

/**
 * Every field in an extension is forbidden when the specialty_code
 * discriminator says a different specialty. Auto-emitted so individual
 * fields don't need to repeat the predicate.
 */
function emitSpecialtyExclusivity(extensionKey: string): void {
  for (const section of SECTIONS) {
    for (const f of section.fields) {
      const cfg = (f.config ??= {});
      const logic = (cfg.logic ??= {});
      const preds: Predicate[] = (logic.predicates ??= []);
      preds.push({
        effect: 'forbidden',
        when: { ne: { specialty_code: extensionKey } },
        message: `${f.code} is only allowed when specialty_code is ${extensionKey}`,
      });
    }
  }
}

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
  return config;
}

export async function seedObgynBookVisitExtension(
  prisma: PrismaClient,
  parentTemplate: FormTemplate,
): Promise<FormTemplate> {
  emitSpecialtyExclusivity(EXTENSION_KEY);
  emitAutoForbiddenPredicates();
  assertAllValid();

  const gynSpecialty = await prisma.specialty.findUnique({
    where: { code: 'GYN' },
  });

  const extension = await prisma.formTemplate.upsert({
    where: {
      code_version: { code: TEMPLATE_CODE, version: TEMPLATE_VERSION },
    },
    update: {
      name: 'OB/GYN Book Visit Extension',
      description:
        'OB/GYN-specific clinical intake for the book_visit shell. Composes when specialty_code=OBGYN.',
      scope: 'BOOK_VISIT',
      specialty_id: gynSpecialty?.id ?? null,
      parent_template_id: parentTemplate.id,
      extension_key: EXTENSION_KEY,
    },
    create: {
      code: TEMPLATE_CODE,
      version: TEMPLATE_VERSION,
      name: 'OB/GYN Book Visit Extension',
      description:
        'OB/GYN-specific clinical intake for the book_visit shell. Composes when specialty_code=OBGYN.',
      scope: 'BOOK_VISIT',
      status: 'DRAFT',
      specialty_id: gynSpecialty?.id ?? null,
      parent_template_id: parentTemplate.id,
      extension_key: EXTENSION_KEY,
    },
  });

  for (let i = 0; i < SECTIONS.length; i++) {
    const sectionSpec = SECTIONS[i];
    const section = await prisma.formSection.upsert({
      where: {
        form_template_id_code: {
          form_template_id: extension.id,
          code: sectionSpec.code,
        },
      },
      update: {
        name: sectionSpec.name,
        order: i,
        config: buildSectionConfig(sectionSpec),
      },
      create: {
        form_template_id: extension.id,
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

  return extension;
}
