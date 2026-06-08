import { NotFoundException } from '@nestjs/common';
import { HistorySummaryService } from './history-summary.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';

const mockPrismaService = {
  db: {
    patientObgynHistory: { findUnique: jest.fn() },
    patient: { findUnique: jest.fn() },
    visitObgynEncounter: { findMany: jest.fn() },
    formTemplate: { findFirst: jest.fn() },
  },
};

const mockAccess = { assertPatientAccessible: jest.fn() };

const mockUser: AuthContext = {
  userId: 'user-1',
  profileId: 'profile-1',
  organizationId: 'org-1',
  roles: ['STAFF'],
  branchIds: [],
};

// A singleton row with all child JSON-array columns empty unless overridden.
function historyRow(overrides: Record<string, unknown> = {}) {
  return {
    obstetric_summary: null,
    gynecological_baseline: null,
    gynecologic_conditions: null,
    gynecologic_procedures: null,
    medical_chronic_illnesses: null,
    screening_history: null,
    social_history: null,
    blood_group_rh: null,
    pregnancies: null,
    non_gyn_surgeries: null,
    family_members: null,
    allergies: null,
    medications: null,
    ...overrides,
  };
}

function resetDefaults() {
  jest.clearAllMocks();
  mockAccess.assertPatientAccessible.mockResolvedValue(undefined);
  mockPrismaService.db.patient.findUnique.mockResolvedValue({
    date_of_birth: new Date('1990-01-01'),
  });
  mockPrismaService.db.visitObgynEncounter.findMany.mockResolvedValue([]);
  mockPrismaService.db.formTemplate.findFirst.mockResolvedValue({
    sections: [
      {
        fields: [
          {
            binding_path: 'medical_chronic_illnesses.items',
            config: {
              validation: { options: [{ code: 'HTN', label: 'Hypertension' }] },
            },
          },
          {
            binding_path: 'family_members.condition',
            config: {
              validation: {
                options: [{ code: 'BREAST_CANCER', label: 'Breast cancer' }],
              },
            },
          },
        ],
      },
    ],
  });
}

describe('HistorySummaryService', () => {
  let service: HistorySummaryService;

  beforeEach(() => {
    resetDefaults();
    service = new HistorySummaryService(
      mockPrismaService as unknown as never,
      mockAccess as unknown as never,
    );
  });

  it('propagates NotFoundException and skips DB reads', async () => {
    mockAccess.assertPatientAccessible.mockRejectedValue(
      new NotFoundException(),
    );
    await expect(
      service.getObgynHistorySummary('p1', mockUser),
    ).rejects.toThrow(NotFoundException);
    expect(
      mockPrismaService.db.patientObgynHistory.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('returns history_exists: false when no history row', async () => {
    mockPrismaService.db.patientObgynHistory.findUnique.mockResolvedValue(null);
    const r = await service.getObgynHistorySummary('p1', mockUser);
    expect(r.history_exists).toBe(false);
    expect(r.identifier.gtpal).toBeNull();
    expect(r.sections).toEqual([]);
  });

  it('computes GTPAL from pregnancy rows (JSON column)', async () => {
    mockPrismaService.db.patientObgynHistory.findUnique.mockResolvedValue(
      historyRow({
        obstetric_summary: { gravida: 3 },
        pregnancies: [
          {
            outcome: 'LIVE_BIRTH',
            gestational_age_weeks: 40,
            neonatal_outcome: 'LIVE_BIRTH',
          },
          {
            outcome: 'LIVE_BIRTH',
            gestational_age_weeks: 34,
            neonatal_outcome: 'LIVE_BIRTH',
          },
          {
            outcome: 'MISCARRIAGE',
            gestational_age_weeks: null,
            neonatal_outcome: null,
          },
        ],
      }),
    );

    const r = await service.getObgynHistorySummary('p1', mockUser);
    expect(r.identifier.gtpal).toEqual({ g: 3, t: 1, p: 1, a: 1, l: 2 });
    expect(r.identifier.gtpal_label).toBe('G3 T1 P1 A1 L2');
  });

  it('builds family history from family_members JSON + a gyn-cancer flag', async () => {
    mockPrismaService.db.patientObgynHistory.findUnique.mockResolvedValue(
      historyRow({
        family_members: [{ condition: 'BREAST_CANCER', relative: 'Mother' }],
      }),
    );

    const r = await service.getObgynHistorySummary('p1', mockUser);
    const fhx = r.sections.find((s) => s.code === 'family_history');
    expect(fhx?.status).toBe('positive');
    expect(fhx?.items).toEqual(['Breast cancer (Mother)']);
    expect(r.flags.some((f) => f.label === 'GYN cancer FH')).toBe(true);
  });

  it('lists only ongoing medications from the JSON column', async () => {
    mockPrismaService.db.patientObgynHistory.findUnique.mockResolvedValue(
      historyRow({
        medications: [
          { drug_name: 'Metformin', dose: '500mg', is_ongoing: true },
          { drug_name: 'Amoxicillin', dose: '500mg', is_ongoing: false },
        ],
      }),
    );

    const r = await service.getObgynHistorySummary('p1', mockUser);
    const meds = r.sections.find((s) => s.code === 'medications');
    expect(meds?.status).toBe('positive');
    expect(meds?.items).toEqual(['Metformin 500mg']);
  });

  it('pulls LMP from the latest visit examination', async () => {
    mockPrismaService.db.patientObgynHistory.findUnique.mockResolvedValue(
      historyRow(),
    );
    mockPrismaService.db.visitObgynEncounter.findMany.mockResolvedValue([
      { menstrual_findings: { cycle: 'REGULAR' } },
      { menstrual_findings: { lmp: '2026-05-01' } },
    ]);

    const r = await service.getObgynHistorySummary('p1', mockUser);
    expect(r.identifier.lmp).toBe('2026-05-01');
  });

  it('emits pertinent negatives for empty clinical sections', async () => {
    mockPrismaService.db.patientObgynHistory.findUnique.mockResolvedValue(
      historyRow(),
    );

    const r = await service.getObgynHistorySummary('p1', mockUser);
    const allergies = r.sections.find((s) => s.code === 'allergies');
    expect(allergies?.status).toBe('negative');
    expect(allergies?.items).toEqual(['No known allergies']);
    expect(r.flags.some((f) => f.label === 'No known allergies')).toBe(true);
  });
});
