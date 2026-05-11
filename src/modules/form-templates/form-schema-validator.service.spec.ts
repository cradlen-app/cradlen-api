import {
  FormSchema,
  FormSchemaValidatorService,
} from './form-schema-validator.service';

describe('FormSchemaValidatorService', () => {
  const validator = new FormSchemaValidatorService();

  const schema = (
    fields: FormSchema['sections'][number]['fields'],
  ): FormSchema => ({
    sections: [{ code: 'main', fields }],
  });

  it('reports required field errors with field-code keys', () => {
    const result = validator.validate(
      schema([{ code: 'lmp_date', type: 'DATE', required: true }]),
      {},
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual({ lmp_date: ['required'] });
  });

  it('skips required check when show_if predicate is unmet', () => {
    const result = validator.validate(
      schema([
        { code: 'pregnant', type: 'BOOLEAN' },
        {
          code: 'lmp_date',
          type: 'DATE',
          required: true,
          show_if: { field: 'pregnant', equals: true },
        },
      ]),
      { pregnant: false },
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('enforces required when show_if predicate is met', () => {
    const result = validator.validate(
      schema([
        { code: 'pregnant', type: 'BOOLEAN' },
        {
          code: 'lmp_date',
          type: 'DATE',
          required: true,
          show_if: { field: 'pregnant', equals: true },
        },
      ]),
      { pregnant: true },
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual({ lmp_date: ['required'] });
  });

  it('validates options for SINGLE_SELECT and MULTI_SELECT', () => {
    const single = validator.validate(
      schema([
        {
          code: 'outcome',
          type: 'SINGLE_SELECT',
          options: [{ code: 'LIVE_BIRTH' }, { code: 'MISCARRIAGE' }],
        },
      ]),
      { outcome: 'STILLBIRTH' },
    );
    expect(single.errors).toEqual({ outcome: ['invalid option'] });

    const multi = validator.validate(
      schema([
        {
          code: 'symptoms',
          type: 'MULTI_SELECT',
          options: [{ code: 'PAIN' }, { code: 'FEVER' }],
        },
      ]),
      { symptoms: ['PAIN', 'NAUSEA'] },
    );
    expect(multi.errors).toEqual({ symptoms: ['invalid option in array'] });
  });

  it('reports numeric min/max and integer constraint violations', () => {
    const result = validator.validate(
      schema([
        { code: 'gravidity', type: 'INTEGER', min: 0, max: 20 },
        { code: 'weight_kg', type: 'NUMBER', min: 30, max: 300 },
      ]),
      { gravidity: 1.5, weight_kg: 10 },
    );
    expect(result.errors).toEqual({
      gravidity: ['must be an integer'],
      weight_kg: ['min 30'],
    });
  });

  it('enforces string regex / length constraints', () => {
    const result = validator.validate(
      schema([
        { code: 'icd', type: 'TEXT', regex: '^[A-Z]\\d{2}$' },
        { code: 'note', type: 'LONG_TEXT', max_length: 5 },
      ]),
      { icd: 'bad', note: 'too long' },
    );
    expect(result.errors).toEqual({
      icd: ['invalid format'],
      note: ['max length 5'],
    });
  });

  it('validates REPEATING_GROUP rows with indexed error paths', () => {
    const result = validator.validate(
      schema([
        {
          code: 'previous_pregnancies',
          type: 'REPEATING_GROUP',
          fields: [
            { code: 'year', type: 'INTEGER', required: true },
            {
              code: 'outcome',
              type: 'SINGLE_SELECT',
              required: true,
              options: [{ code: 'LIVE_BIRTH' }, { code: 'MISCARRIAGE' }],
            },
            {
              code: 'mode_of_delivery',
              type: 'SINGLE_SELECT',
              required: true,
              options: [{ code: 'NSVD' }, { code: 'C_SECTION' }],
              show_if: { field: 'outcome', equals: 'LIVE_BIRTH' },
            },
          ],
        },
      ]),
      {
        previous_pregnancies: [
          { year: 2018, outcome: 'LIVE_BIRTH', mode_of_delivery: 'NSVD' },
          { year: 2020, outcome: 'LIVE_BIRTH' },
          { year: 2022, outcome: 'MISCARRIAGE' },
        ],
      },
    );
    expect(result.errors).toEqual({
      'previous_pregnancies[1].mode_of_delivery': ['required'],
    });
    expect(result.sanitized.previous_pregnancies).toEqual([
      { year: 2018, outcome: 'LIVE_BIRTH', mode_of_delivery: 'NSVD' },
      { year: 2020, outcome: 'LIVE_BIRTH' },
      { year: 2022, outcome: 'MISCARRIAGE' },
    ]);
  });

  it('drops unknown field codes from responses', () => {
    const result = validator.validate(
      schema([{ code: 'note', type: 'TEXT' }]),
      { note: 'ok', rogue_field: 'nope' },
    );
    expect(result.valid).toBe(true);
    expect(result.sanitized).toEqual({ note: 'ok' });
  });

  it('strips client-submitted values for COMPUTED fields', () => {
    const result = validator.validate(
      schema([
        { code: 'weight_kg', type: 'NUMBER' },
        { code: 'height_cm', type: 'NUMBER' },
        {
          code: 'bmi',
          type: 'COMPUTED',
          expression: 'weight_kg / ((height_cm/100)**2)',
        },
      ]),
      { weight_kg: 70, height_cm: 170, bmi: 999 },
    );
    expect(result.sanitized).toEqual({ weight_kg: 70, height_cm: 170 });
  });
});
