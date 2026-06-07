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

  it('attributes the REQUIRED message to the predicate that actually triggered', async () => {
    const row = makeRow();
    // Two required predicates on the doctor field: the first does NOT match the
    // payload, the second does. The surfaced message must be the second's.
    row.sections[0].fields[1].config.logic.predicates = [
      {
        effect: 'required',
        when: { eq: { visitor_type: 'MEDICAL_REP' } },
        message: 'wrong — rep branch',
      },
      {
        effect: 'required',
        when: { eq: { visitor_type: 'PATIENT' } },
        message: 'right — patient branch',
      },
    ] satisfies Predicate[];
    const templates = {
      findActiveByCode: jest.fn().mockResolvedValue(row),
    } as unknown as TemplatesService;
    const v = new TemplateValidator(templates, renderer);

    const result = await v.validatePayload('obgyn_book_visit', {
      visitor_type: 'PATIENT',
      // assigned_doctor_id absent → required predicate triggers
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        expect.objectContaining({
          fieldCode: 'assigned_doctor_patient',
          code: 'REQUIRED',
          message: 'right — patient branch',
        }),
      ]);
    }
  });

  it('emits at most one FORBIDDEN error when multiple forbidden predicates match', async () => {
    const row = makeRow();
    row.sections[0].fields[2].config.logic.predicates = [
      { effect: 'forbidden', when: { eq: { visitor_type: 'PATIENT' } } },
      { effect: 'forbidden', when: { ne: { visitor_type: 'MEDICAL_REP' } } },
    ] satisfies Predicate[];
    const templates = {
      findActiveByCode: jest.fn().mockResolvedValue(row),
    } as unknown as TemplatesService;
    const v = new TemplateValidator(templates, renderer);

    const result = await v.validatePayload('obgyn_book_visit', {
      visitor_type: 'PATIENT',
      assigned_doctor_id: 'doc-uuid',
      full_name: 'leaked-rep-name',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const forbidden = result.errors.filter(
        (e) => e.fieldCode === 'rep_full_name',
      );
      expect(forbidden).toHaveLength(1);
      expect(forbidden[0].code).toBe('FORBIDDEN');
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

/**
 * Fixture with no required/predicate fields — only `config.validation`
 * constraints — so an empty payload passes and a present malformed value is
 * the sole error. Covers the server-side enforcement of `config.validation`.
 */
function makeConstraintRow(): any {
  return {
    id: 't2',
    code: 'constraints',
    name: 'Constraints',
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
        code: 'patient_info',
        name: 'Patient info',
        order: 0,
        config: { ui: {}, validation: {}, logic: {} },
        is_deleted: false,
        fields: [
          {
            id: 'f-nid',
            code: 'national_id',
            label: 'National ID',
            type: 'TEXT',
            order: 0,
            required: false,
            binding_namespace: 'PATIENT',
            binding_path: 'national_id',
            config: {
              ui: {},
              validation: {
                minLength: 8,
                maxLength: 20,
                pattern: '^[0-9]{8,20}$',
              },
              logic: {},
            },
            is_deleted: false,
          },
          {
            id: 'f-score',
            code: 'score',
            label: 'Score',
            type: 'NUMBER',
            order: 1,
            required: false,
            binding_namespace: 'VISIT',
            binding_path: 'score',
            config: { ui: {}, validation: { min: 1, max: 10 }, logic: {} },
            is_deleted: false,
          },
          {
            id: 'f-dob',
            code: 'date_of_birth',
            label: 'Date of birth',
            type: 'DATE',
            order: 2,
            required: false,
            binding_namespace: 'PATIENT',
            binding_path: 'date_of_birth',
            config: {
              ui: {},
              validation: { notInFuture: true, maxAgeYears: 120 },
              logic: {},
            },
            is_deleted: false,
          },
        ],
      },
    ],
  };
}

function makeConstraintValidator(): TemplateValidator {
  const templates = {
    findActiveByCode: jest.fn().mockResolvedValue(makeConstraintRow()),
  } as unknown as TemplatesService;
  return new TemplateValidator(templates, renderer);
}

describe('TemplateValidator — config.validation constraints', () => {
  it('passes when all present values satisfy their constraints', async () => {
    const v = makeConstraintValidator();
    const result = await v.validatePayload('constraints', {
      national_id: '12345678',
      score: 5,
      date_of_birth: '1990-01-01',
    });
    expect(result.ok).toBe(true);
  });

  it('passes when no constrained value is present (empty payload)', async () => {
    const v = makeConstraintValidator();
    const result = await v.validatePayload('constraints', {});
    expect(result.ok).toBe(true);
  });

  it('flags INVALID_FORMAT when a string fails its pattern', async () => {
    const v = makeConstraintValidator();
    const result = await v.validatePayload('constraints', {
      national_id: 'abcdefgh', // right length, not digits
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        expect.objectContaining({
          fieldCode: 'national_id',
          code: 'INVALID_FORMAT',
        }),
      ]);
    }
  });

  it('flags TOO_SHORT before pattern when under minLength', async () => {
    const v = makeConstraintValidator();
    const result = await v.validatePayload('constraints', {
      national_id: '123',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        expect.objectContaining({
          fieldCode: 'national_id',
          code: 'TOO_SHORT',
        }),
      ]);
    }
  });

  it('flags TOO_LONG when over maxLength', async () => {
    const v = makeConstraintValidator();
    const result = await v.validatePayload('constraints', {
      national_id: '123456789012345678901', // 21 digits
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        expect.objectContaining({
          fieldCode: 'national_id',
          code: 'TOO_LONG',
        }),
      ]);
    }
  });

  it('flags OUT_OF_RANGE for numeric min/max (string-coerced too)', async () => {
    const v = makeConstraintValidator();
    const high = await v.validatePayload('constraints', { score: 50 });
    expect(high.ok).toBe(false);
    if (!high.ok) {
      expect(high.errors[0]).toEqual(
        expect.objectContaining({ fieldCode: 'score', code: 'OUT_OF_RANGE' }),
      );
    }
    const low = await v.validatePayload('constraints', { score: '0' });
    expect(low.ok).toBe(false);
    if (!low.ok) {
      expect(low.errors[0].code).toBe('OUT_OF_RANGE');
    }
  });

  it('flags INVALID_DATE for a future date_of_birth', async () => {
    const v = makeConstraintValidator();
    const tomorrow = new Date(Date.now() + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const result = await v.validatePayload('constraints', {
      date_of_birth: tomorrow,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toEqual(
        expect.objectContaining({
          fieldCode: 'date_of_birth',
          code: 'INVALID_DATE',
        }),
      );
    }
  });

  it('flags INVALID_DATE when older than maxAgeYears', async () => {
    const v = makeConstraintValidator();
    const result = await v.validatePayload('constraints', {
      date_of_birth: '1800-01-01',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].code).toBe('INVALID_DATE');
    }
  });

  it('flags INVALID_DATE for an unparseable date', async () => {
    const v = makeConstraintValidator();
    const result = await v.validatePayload('constraints', {
      date_of_birth: 'not-a-date',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].code).toBe('INVALID_DATE');
    }
  });

  it('still enforces format under sparse (PATCH) semantics', async () => {
    const v = makeConstraintValidator();
    const bad = await v.validatePayload(
      'constraints',
      { national_id: 'abcdefgh' },
      { sparse: true },
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors[0].code).toBe('INVALID_FORMAT');
    }
    const good = await v.validatePayload(
      'constraints',
      { national_id: '12345678' },
      { sparse: true },
    );
    expect(good.ok).toBe(true);
  });
});
