import { NotFoundException } from '@nestjs/common';
import { HistorySummaryService } from './history-summary.service';

const mockPrismaService = {
  db: {
    patientObgynHistory: {
      findUnique: jest.fn(),
    },
  },
};

const mockAccess = {
  assertPatientInOrg: jest.fn(),
};

const mockUser = {
  userId: 'user-1',
  profileId: 'profile-1',
  organizationId: 'org-1',
  roles: ['STAFF'],
  branchIds: [],
};

describe('HistorySummaryService', () => {
  let service: HistorySummaryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new HistorySummaryService(
      mockPrismaService as any,
      mockAccess as any,
    );
  });

  describe('getObgynHistorySummary', () => {
    it('calls assertPatientInOrg with patientId and user', async () => {
      mockPrismaService.db.patientObgynHistory.findUnique.mockResolvedValue(null);
      await service.getObgynHistorySummary('patient-1', mockUser as any);
      expect(mockAccess.assertPatientInOrg).toHaveBeenCalledWith('patient-1', mockUser);
      expect(mockPrismaService.db.patientObgynHistory.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ patient_id: 'patient-1' }) }),
      );
    });

    it('returns history_exists: false when no history row exists', async () => {
      mockPrismaService.db.patientObgynHistory.findUnique.mockResolvedValue(null);
      const result = await service.getObgynHistorySummary('patient-1', mockUser as any);
      expect(result.history_exists).toBe(false);
      expect(result.allergies).toEqual([]);
      expect(result.current_medications).toEqual([]);
      expect(result.obstetric_summary).toBeNull();
      expect(result.gynecological_baseline).toBeNull();
      expect(result.medical_chronic_illnesses).toBeNull();
      expect(result.family_history).toBeNull();
      expect(result.social_history).toBeNull();
      expect(result.screening_history).toBeNull();
      expect(result.section_timestamps).toBeNull();
    });

    it('returns history_exists: true with all fields populated when row exists', async () => {
      const mockHistory = {
        obstetric_summary: { gravida: 2, para: 1, abortion: 0, ectopic: 0, stillbirths: 0 },
        gynecological_baseline: { age_at_menarche: 13, cycle_regularity: 'REGULAR', dysmenorrhea: false },
        medical_chronic_illnesses: { items: ['Hypertension'], notes: '' },
        family_history: { gynecologic_cancers: ['Breast cancer'], chronic_illnesses: [] },
        social_history: { smoking: 'NEVER', alcohol: 'NEVER' },
        screening_history: { pap_smear: 'NORMAL', pap_smear_date: '2025-01-01', mammography: null, mammography_date: null },
        section_timestamps: { gynecological_baseline: '2025-01-01T00:00:00.000Z' },
        allergies: [{ allergy_to: 'Penicillin', severity: 'SEVERE', associated_symptoms: 'Rash' }],
        medications: [{ drug_name: 'Metformin', dose: '500mg', frequency: 'TWICE_DAILY', is_ongoing: true }],
      };
      mockPrismaService.db.patientObgynHistory.findUnique.mockResolvedValue(mockHistory);

      const result = await service.getObgynHistorySummary('patient-1', mockUser as any);

      expect(result.history_exists).toBe(true);
      expect(result.allergies).toEqual([{ allergy_to: 'Penicillin', severity: 'SEVERE', associated_symptoms: 'Rash' }]);
      expect(result.current_medications).toEqual([{ drug_name: 'Metformin', dose: '500mg', frequency: 'TWICE_DAILY', is_ongoing: true }]);
      expect(result.obstetric_summary).toEqual(mockHistory.obstetric_summary);
      expect(result.gynecological_baseline).toEqual(mockHistory.gynecological_baseline);
      expect(result.family_history).toEqual(mockHistory.family_history);
      expect(result.social_history).toEqual(mockHistory.social_history);
      expect(result.medical_chronic_illnesses).toEqual(mockHistory.medical_chronic_illnesses);
      expect(result.screening_history).toEqual(mockHistory.screening_history);
      expect(result.section_timestamps).toEqual(mockHistory.section_timestamps);
    });

    it('returns empty arrays when history exists but no allergies or medications', async () => {
      const mockHistory = {
        obstetric_summary: null,
        gynecological_baseline: null,
        medical_chronic_illnesses: null,
        family_history: null,
        social_history: null,
        screening_history: null,
        section_timestamps: null,
        allergies: [],
        medications: [],
      };
      mockPrismaService.db.patientObgynHistory.findUnique.mockResolvedValue(mockHistory);

      const result = await service.getObgynHistorySummary('patient-1', mockUser as any);

      expect(result.history_exists).toBe(true);
      expect(result.allergies).toEqual([]);
      expect(result.current_medications).toEqual([]);
    });

    it('propagates NotFoundException from assertPatientInOrg', async () => {
      mockAccess.assertPatientInOrg.mockRejectedValue(new NotFoundException('Patient patient-1 not found'));
      await expect(service.getObgynHistorySummary('patient-1', mockUser as any)).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.db.patientObgynHistory.findUnique).not.toHaveBeenCalled();
    });
  });
});
