/* eslint-disable @typescript-eslint/no-explicit-any */
import { TemplateValidator } from './template.validator';
import { TemplatesService } from '../templates/templates.service';
import { TemplateRendererService } from '../renderer/template-renderer.service';
import type { Predicate } from '../rules/predicates';

const renderer = new TemplateRendererService();

function makeRow(): any {
  return {
    id: 't',
    code: 'obgyn_book_visit',
    name: 'OB/GYN Book Visit',
    description: null,
    scope: 'BOOK_VISIT',
    version: 1,
    status: 'PUBLISHED',
    published_at: new Date(),
    is_active: true,
    activated_at: new Date(),
    specialty_id: null,
    sections: [
      {
        id: 's1',
        code: 'visit_metadata',
        name: 'Visit metadata',
        order: 0,
        config: { ui: {}, validation: {}, logic: {} },
        is_deleted: false,
        fields: [
          {
            id: 'f-visitor-type',
            code: 'visitor_type',
            label: 'Visitor type',
            type: 'SELECT',
            order: 0,
            required: true,
            binding_namespace: 'SYSTEM',
            binding_path: 'visitor_type',
            config: {
              ui: {},
              validation: { options: [{ code: 'PATIENT', label: 'Patient' }] },
              logic: { is_discriminator: true },
            },
            is_deleted: false,
          },
          {
            id: 'f-doctor',
            code: 'assigned_doctor_patient',
            label: 'Assigned doctor',
            type: 'ENTITY_SEARCH',
            order: 1,
            required: false,
            binding_namespace: 'VISIT',
            binding_path: 'assigned_doctor_id',
            config: {
              ui: {},
              validation: {},
              logic: {
                entity: 'doctor',
                predicates: [
                  {
                    effect: 'required',
                    when: { eq: { visitor_type: 'PATIENT' } },
                  },
                ] satisfies Predicate[],
              },
            },
            is_deleted: false,
          },
          {
            id: 'f-rep-name',
            code: 'rep_full_name',
            label: 'Rep full name',
            type: 'TEXT',
            order: 2,
            required: false,
            binding_namespace: 'MEDICAL_REP',
            binding_path: 'full_name',
            config: {
              ui: {},
              validation: {},
              logic: {
                predicates: [
                  {
                    effect: 'forbidden',
                    when: { eq: { visitor_type: 'PATIENT' } },
                  },
                ] satisfies Predicate[],
              },
            },
            is_deleted: false,
          },
        ],
      },
    ],
  };
}

function makeValidator(): TemplateValidator {
  const templates = {
    findActiveByCode: jest.fn().mockResolvedValue(makeRow()),
  } as unknown as TemplatesService;
  return new TemplateValidator(templates, renderer);
}

describe('TemplateValidator', () => {
  it('passes when required predicate is satisfied and forbidden predicate is not triggered', async () => {
    const v = makeValidator();
    const result = await v.validatePayload('obgyn_book_visit', {
      visitor_type: 'PATIENT',
      assigned_doctor_id: 'doc-uuid',
    });
    expect(result.ok).toBe(true);
  });

  it('fails with REQUIRED when a `required` predicate triggers and value is missing', async () => {
    const v = makeValidator();
    const result = await v.validatePayload('obgyn_book_visit', {
      visitor_type: 'PATIENT',
      // assigned_doctor_id absent
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        expect.objectContaining({
          fieldCode: 'assigned_doctor_patient',
          code: 'REQUIRED',
        }),
      ]);
    }
  });

  it('fails with FORBIDDEN when a cross-namespace field leaks into the wrong payload', async () => {
    const v = makeValidator();
    const result = await v.validatePayload('obgyn_book_visit', {
      visitor_type: 'PATIENT',
      assigned_doctor_id: 'doc-uuid',
      full_name: 'leaked-rep-name', // MEDICAL_REP namespace field present
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        expect.objectContaining({
          fieldCode: 'rep_full_name',
          code: 'FORBIDDEN',
        }),
      ]);
    }
  });

  it('column-level `required: true` is enforced independently of predicates', async () => {
    const v = makeValidator();
    const result = await v.validatePayload('obgyn_book_visit', {
      // visitor_type absent — column-level required
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          fieldCode: 'visitor_type',
          code: 'REQUIRED',
        }),
      );
    }
  });
});
