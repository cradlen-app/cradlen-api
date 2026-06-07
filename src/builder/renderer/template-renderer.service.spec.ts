import { TemplateRendererService } from './template-renderer.service';
import type { HydratableTemplate } from './template-renderer.service';

const renderer = new TemplateRendererService();

function makeRow(): HydratableTemplate {
  return {
    id: 't',
    code: 'book_visit',
    name: 'Book Visit',
    description: null,
    scope: 'BOOK_VISIT',
    version: 1,
    activated_at: new Date(),
    is_display_only: false,
    specialty_id: null,
    sections: [
      {
        id: 's1',
        code: 'patient_info',
        name: 'Patient info',
        order: 0,
        is_repeatable: false,
        config: {
          ui: {},
          validation: {},
          logic: {},
          i18n: { ar: { name: 'بيانات المريض' } },
        },
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
              ui: { placeholder: 'Enter ID' },
              validation: {},
              i18n: {
                ar: { label: 'الرقم القومي', placeholder: 'أدخل الرقم' },
              },
            },
          },
          {
            id: 'f-marital',
            code: 'marital_status',
            label: 'Marital status',
            type: 'SELECT',
            order: 1,
            required: false,
            binding_namespace: 'PATIENT',
            binding_path: 'marital_status',
            config: {
              validation: {
                options: [
                  { code: 'SINGLE', label: 'Single' },
                  { code: 'MARRIED', label: 'Married' },
                ],
              },
              i18n: {
                ar: {
                  label: 'الحالة الاجتماعية',
                  options: { SINGLE: 'أعزب', MARRIED: 'متزوج' },
                },
              },
            },
          },
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('TemplateRendererService — locale overlay', () => {
  it('overlays Arabic label/placeholder/option labels and section name for locale "ar"', () => {
    const out = renderer.render(makeRow(), 'ar');
    const section = out.sections[0];
    expect(section.name).toBe('بيانات المريض');

    const nid = section.fields[0];
    expect(nid.label).toBe('الرقم القومي');
    expect(nid.config.ui?.placeholder).toBe('أدخل الرقم');

    const marital = section.fields[1];
    expect(marital.label).toBe('الحالة الاجتماعية');
    expect(marital.config.validation?.options).toEqual([
      { code: 'SINGLE', label: 'أعزب' },
      { code: 'MARRIED', label: 'متزوج' },
    ]);
  });

  it('returns English base for the default locale', () => {
    const out = renderer.render(makeRow()); // no locale → 'en'
    const section = out.sections[0];
    expect(section.name).toBe('Patient info');
    expect(section.fields[0].label).toBe('National ID');
    expect(section.fields[0].config.ui?.placeholder).toBe('Enter ID');
    expect(section.fields[1].config.validation?.options).toEqual([
      { code: 'SINGLE', label: 'Single' },
      { code: 'MARRIED', label: 'Married' },
    ]);
  });

  it('strips config.i18n from the wire for every locale', () => {
    for (const locale of ['ar', 'en', undefined] as const) {
      const out = renderer.render(makeRow(), locale);
      expect(out.sections[0].config).not.toHaveProperty('i18n');
      for (const field of out.sections[0].fields) {
        expect(field.config).not.toHaveProperty('i18n');
      }
    }
  });

  it('falls back to the base value when a locale key is missing', () => {
    // Only an unrelated locale present → 'ar' has no entry → English kept.
    const row = makeRow();
    const field = row.sections[0].fields[0];
    (field.config as Record<string, unknown>).i18n = { fr: { label: 'NID' } };
    const out = renderer.render(row, 'ar');
    expect(out.sections[0].fields[0].label).toBe('National ID');
  });
});
