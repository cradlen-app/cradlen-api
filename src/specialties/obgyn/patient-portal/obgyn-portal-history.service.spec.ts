import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '@infrastructure/database/prisma.service';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface';
import { ObgynPortalHistoryService } from './obgyn-portal-history.service';
import { ObgynHistoryService } from '../patient-history/obgyn-history.service';
import {
  composeObgynHistoryGroup,
  type TemplateSectionInput,
} from './obgyn-portal-history.composer';

function patientCtx(ids: string[]): PatientAuthContext {
  return { userId: 'u1', patientId: ids[0], accessiblePatientIds: ids };
}

function templateSections(): TemplateSectionInput[] {
  return [
    {
      code: 'menstrual_history',
      name: 'Menstrual History',
      is_repeatable: false,
      fields: [
        {
          label: 'Age at menarche',
          binding_path: 'gynecological_baseline.age_at_menarche',
          config: {},
        },
        {
          label: 'Cycle regularity',
          binding_path: 'gynecological_baseline.cycle_regularity',
          config: {
            validation: {
              options: [
                { code: 'REGULAR', label: 'Regular' },
                { code: 'IRREGULAR', label: 'Irregular' },
              ],
            },
          },
        },
        {
          label: 'Flow',
          binding_path: 'gynecological_baseline.flow',
          config: {},
        },
      ],
    },
    {
      code: 'pregnancies',
      name: 'Previous Pregnancy Details',
      is_repeatable: true,
      fields: [
        {
          label: 'Birth date',
          binding_path: 'pregnancies.birth_date',
          config: {},
        },
        {
          label: 'Outcome',
          binding_path: 'pregnancies.outcome',
          config: {
            validation: {
              options: [{ code: 'LIVE_BIRTH', label: 'Live birth' }],
            },
          },
        },
      ],
    },
    {
      code: 'allergies',
      name: 'Allergies',
      is_repeatable: true,
      fields: [
        {
          label: 'Allergy to',
          binding_path: 'allergies.allergy_to',
          config: {},
        },
      ],
    },
    {
      code: 'medications',
      name: 'Medications',
      is_repeatable: true,
      fields: [
        {
          label: 'Drug name',
          binding_path: 'medications.drug_name',
          config: {},
        },
        // Internal id target — must never be surfaced.
        {
          label: 'Medication id',
          binding_path: 'medications.medication_id',
          config: {},
        },
      ],
    },
  ];
}

function envelopeWithData(): Record<string, unknown> {
  return {
    version: 3,
    gynecological_baseline: {
      age_at_menarche: 13,
      cycle_regularity: 'REGULAR',
      flow: '',
    },
    pregnancies: [
      {
        birth_date: new Date('2023-05-01T00:00:00.000Z'),
        outcome: 'LIVE_BIRTH',
      },
    ],
    medications: [{ drug_name: 'Folic acid', medication_id: 'med-uuid-123' }],
    contraceptives: [],
    non_gyn_surgeries: [],
    family_members: [],
    allergies: [],
  };
}

describe('composeObgynHistoryGroup', () => {
  it('composes a singleton section, mapping enum codes and omitting empty fields', () => {
    const group = composeObgynHistoryGroup(
      templateSections(),
      envelopeWithData(),
    );

    expect(group.code).toBe('OBGYN');
    expect(group.version).toBe(3);

    const menstrual = group.sections.find(
      (s) => s.code === 'menstrual_history',
    );
    expect(menstrual?.entries).toHaveLength(1);
    expect(menstrual?.entries[0].title).toBeNull();
    expect(menstrual?.entries[0].rows).toEqual([
      { label: 'Age at menarche', value: '13' },
      { label: 'Cycle regularity', value: 'Regular' },
      // "Flow" omitted — empty string.
    ]);
  });

  it('renders a repeatable section as titled entries and formats dates', () => {
    const group = composeObgynHistoryGroup(
      templateSections(),
      envelopeWithData(),
    );
    const pregnancies = group.sections.find((s) => s.code === 'pregnancies');

    expect(pregnancies?.entries).toHaveLength(1);
    expect(pregnancies?.entries[0].title).toBe('2023-05-01 · Live birth');
    expect(pregnancies?.entries[0].rows).toEqual([
      { label: 'Birth date', value: '2023-05-01' },
      { label: 'Outcome', value: 'Live birth' },
    ]);
  });

  it('omits empty collections and never surfaces internal id targets', () => {
    const group = composeObgynHistoryGroup(
      templateSections(),
      envelopeWithData(),
    );

    // allergies array is empty → section omitted.
    expect(group.sections.find((s) => s.code === 'allergies')).toBeUndefined();

    // medications row must not include the medication_id helper field.
    const meds = group.sections.find((s) => s.code === 'medications');
    expect(meds?.entries[0].rows).toEqual([
      { label: 'Drug name', value: 'Folic acid' },
    ]);
  });

  it('produces no sections when the envelope has no data', () => {
    const empty = {
      version: 1,
      gynecological_baseline: { flow: '' },
      pregnancies: [],
      medications: [],
      allergies: [],
    };
    const group = composeObgynHistoryGroup(templateSections(), empty);
    expect(group.sections).toEqual([]);
  });
});

describe('ObgynPortalHistoryService', () => {
  function createEnv() {
    const findFirst = jest.fn();
    const readEnvelope = jest.fn();
    const prisma = {
      db: { formTemplate: { findFirst } },
    } as unknown as PrismaService;
    const obgyn = { readEnvelope } as unknown as ObgynHistoryService;
    return {
      service: new ObgynPortalHistoryService(prisma, obgyn),
      findFirst,
      readEnvelope,
    };
  }

  it('rejects a patient_id outside the accessible set (generic 404)', async () => {
    const { service, readEnvelope } = createEnv();
    await expect(
      service.getHistory(patientCtx(['p1']), 'p2'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(readEnvelope).not.toHaveBeenCalled();
  });

  it('returns empty groups when the patient has no history', async () => {
    const { service, readEnvelope, findFirst } = createEnv();
    readEnvelope.mockResolvedValue(null);

    const res = await service.getHistory(patientCtx(['p1']));

    expect(res).toEqual({ patient_id: 'p1', groups: [] });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('composes display-ready groups from the active template and envelope', async () => {
    const { service, readEnvelope, findFirst } = createEnv();
    readEnvelope.mockResolvedValue(envelopeWithData());
    findFirst.mockResolvedValue({
      sections: templateSections().map((s) => ({
        code: s.code,
        name: s.name,
        is_repeatable: s.is_repeatable,
        fields: s.fields,
      })),
    });

    const res = await service.getHistory(patientCtx(['p1', 'p2']), 'p2');

    expect(res.patient_id).toBe('p2');
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].code).toBe('OBGYN');
    expect(res.groups[0].sections.map((s) => s.code)).toEqual([
      'menstrual_history',
      'pregnancies',
      'medications',
    ]);
    expect(readEnvelope).toHaveBeenCalledWith('p2');
  });
});
