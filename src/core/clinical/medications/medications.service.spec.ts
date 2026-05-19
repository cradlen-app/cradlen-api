import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MedicationsService } from './medications.service';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthorizationService } from '@core/auth/authorization/authorization.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { MedicationWithStatsDto } from './dto/medication.dto';

const callerOrg = 'org-A';

const mockUser: AuthContext = {
  userId: 'user-uuid',
  profileId: 'profile-A',
  organizationId: callerOrg,
  activeBranchId: 'branch-uuid',
  roles: ['OWNER'],
  branchIds: ['branch-uuid'],
};

describe('MedicationsService', () => {
  let service: MedicationsService;
  let db: {
    medication: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    prescriptionItem: { findMany: jest.Mock };
    medicalRepMedication: { findMany: jest.Mock };
    medicalRep: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let auth: { isOwner: jest.Mock; assertOwnerOnly: jest.Mock };

  beforeEach(async () => {
    db = {
      medication: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      prescriptionItem: { findMany: jest.fn().mockResolvedValue([]) },
      medicalRepMedication: { findMany: jest.fn().mockResolvedValue([]) },
      medicalRep: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest
        .fn()
        .mockImplementation((arr: Promise<unknown>[]) => Promise.all(arr)),
    };
    auth = {
      isOwner: jest.fn().mockResolvedValue(true),
      assertOwnerOnly: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MedicationsService,
        { provide: PrismaService, useValue: { db } },
        { provide: AuthorizationService, useValue: auth },
      ],
    }).compile();
    service = module.get<MedicationsService>(MedicationsService);
  });

  describe('assertReferenceable', () => {
    it('allows global rows (organization_id = null)', async () => {
      db.medication.findUnique.mockResolvedValue({ organization_id: null });
      await expect(
        service.assertReferenceable('med-uuid', mockUser),
      ).resolves.toBeUndefined();
    });

    it('allows rows owned by the caller org', async () => {
      db.medication.findUnique.mockResolvedValue({
        organization_id: callerOrg,
      });
      await expect(
        service.assertReferenceable('med-uuid', mockUser),
      ).resolves.toBeUndefined();
    });

    it('rejects rows owned by another org with 400', async () => {
      db.medication.findUnique.mockResolvedValue({ organization_id: 'org-B' });
      await expect(
        service.assertReferenceable('med-uuid', mockUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects nonexistent / soft-deleted rows', async () => {
      db.medication.findUnique.mockResolvedValue(null);
      await expect(
        service.assertReferenceable('med-uuid', mockUser),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('create', () => {
    it('throws ConflictException on duplicate code in same org', async () => {
      db.medication.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create({ code: 'CUSTOM', name: 'Custom drug' }, mockUser),
      ).rejects.toThrow(ConflictException);
    });

    it('sets organization_id and added_by_id from caller', async () => {
      db.medication.findFirst.mockResolvedValue(null);
      db.medication.create.mockImplementation(({ data }) => data);
      await service.create({ code: 'NEW_DRUG', name: 'Drug' }, mockUser);
      const data = db.medication.create.mock.calls[0][0].data;
      expect(data.organization_id).toBe(callerOrg);
      expect(data.added_by_id).toBe('profile-A');
    });

    it('persists all new fields when provided', async () => {
      db.medication.findFirst.mockResolvedValue(null);
      db.medication.create.mockImplementation(({ data }) => data);
      await service.create(
        {
          code: 'MED1',
          name: 'Drug',
          category: 'Antibiotic',
          company: 'Pharma Co',
          notes: 'Take with food',
          default_dose_amount: 500,
          default_dose_unit: 'mg',
          default_dose_frequency: 'twice daily',
          default_dose_route: 'oral',
        },
        mockUser,
      );
      const data = db.medication.create.mock.calls[0][0].data;
      expect(data.category).toBe('Antibiotic');
      expect(data.company).toBe('Pharma Co');
      expect(data.notes).toBe('Take with food');
      expect(data.default_dose_amount).toBe(500);
      expect(data.default_dose_unit).toBe('mg');
      expect(data.default_dose_frequency).toBe('twice daily');
      expect(data.default_dose_route).toBe('oral');
    });

    it('stores null for omitted new fields', async () => {
      db.medication.findFirst.mockResolvedValue(null);
      db.medication.create.mockImplementation(({ data }) => data);
      await service.create({ code: 'MED2', name: 'Drug B' }, mockUser);
      const data = db.medication.create.mock.calls[0][0].data;
      expect(data.category).toBeNull();
      expect(data.company).toBeNull();
      expect(data.notes).toBeNull();
      expect(data.default_dose_amount).toBeNull();
      expect(data.default_dose_unit).toBeNull();
      expect(data.default_dose_frequency).toBeNull();
      expect(data.default_dose_route).toBeNull();
    });
  });

  describe('update', () => {
    it('rejects mutations on global rows', async () => {
      db.medication.findUnique.mockResolvedValue({
        id: 'med-uuid',
        organization_id: null,
      });
      await expect(
        service.update('med-uuid', { name: 'tampered' }, mockUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('hides cross-org rows behind 404', async () => {
      db.medication.findUnique.mockResolvedValue({
        id: 'med-uuid',
        organization_id: 'org-B',
      });
      await expect(
        service.update('med-uuid', { name: 'edited' }, mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when caller is non-OWNER and not the original creator', async () => {
      db.medication.findUnique.mockResolvedValue({
        id: 'med-uuid',
        organization_id: callerOrg,
        added_by_id: 'someone-else',
      });
      auth.isOwner.mockResolvedValueOnce(false);
      await expect(
        service.update('med-uuid', { name: 'edited' }, mockUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows OWNER to edit any org-scoped row', async () => {
      db.medication.findUnique.mockResolvedValue({
        id: 'med-uuid',
        organization_id: callerOrg,
        added_by_id: 'someone-else',
      });
      db.medication.update.mockResolvedValue({
        id: 'med-uuid',
        name: 'edited',
      });
      await expect(
        service.update('med-uuid', { name: 'edited' }, mockUser),
      ).resolves.toEqual({ id: 'med-uuid', name: 'edited' });
    });

    it('patches new fields selectively when provided', async () => {
      db.medication.findUnique.mockResolvedValue({
        id: 'med-uuid',
        organization_id: callerOrg,
        added_by_id: 'profile-A',
      });
      db.medication.update.mockResolvedValue({ id: 'med-uuid' });
      await service.update(
        'med-uuid',
        { category: 'Analgesic', default_dose_amount: 250 },
        mockUser,
      );
      const updateData = db.medication.update.mock.calls[0][0].data;
      expect(updateData.category).toBe('Analgesic');
      expect(updateData.default_dose_amount).toBe(250);
      expect(updateData).not.toHaveProperty('company');
      expect(updateData).not.toHaveProperty('notes');
    });
  });

  describe('findAll stats enrichment', () => {
    const med1 = {
      id: 'med-1',
      organization_id: callerOrg,
      code: 'MED1',
      name: 'Drug A',
      generic_name: null,
      form: null,
      strength: null,
      added_by_id: 'profile-A',
      is_deleted: false,
      created_at: new Date(),
      updated_at: new Date(),
    };

    it('returns total_prescriptions: 0 and empty arrays when no data', async () => {
      db.$transaction.mockResolvedValue([[med1], 1]);
      db.prescriptionItem.findMany.mockResolvedValue([]);
      db.medicalRepMedication.findMany.mockResolvedValue([]);

      const result = await service.findAll({}, mockUser);
      const item = result.items[0] as MedicationWithStatsDto;

      expect(item.total_prescriptions).toBe(0);
      expect(item.top_prescribers).toEqual([]);
      expect(item.medical_reps).toEqual([]);
    });

    it('counts prescription items per prescriber and sums total', async () => {
      db.$transaction.mockResolvedValue([[med1], 1]);
      db.prescriptionItem.findMany.mockResolvedValue([
        {
          medication_id: 'med-1',
          prescription: {
            prescribed_by_id: 'doc-1',
            prescribed_by: {
              user: { first_name: 'Alice', last_name: 'Smith' },
            },
          },
        },
        {
          medication_id: 'med-1',
          prescription: {
            prescribed_by_id: 'doc-1',
            prescribed_by: {
              user: { first_name: 'Alice', last_name: 'Smith' },
            },
          },
        },
        {
          medication_id: 'med-1',
          prescription: {
            prescribed_by_id: 'doc-2',
            prescribed_by: { user: { first_name: 'Bob', last_name: 'Jones' } },
          },
        },
      ]);
      db.medicalRepMedication.findMany.mockResolvedValue([]);

      const result = await service.findAll({}, mockUser);
      const item = result.items[0] as MedicationWithStatsDto;

      expect(item.total_prescriptions).toBe(3);
      expect(item.top_prescribers).toHaveLength(2);
      expect(item.top_prescribers[0]).toEqual({
        profile_id: 'doc-1',
        full_name: 'Alice Smith',
        count: 2,
      });
      expect(item.top_prescribers[1]).toEqual({
        profile_id: 'doc-2',
        full_name: 'Bob Jones',
        count: 1,
      });
    });

    it('caps top_prescribers at 5 sorted by count descending', async () => {
      db.$transaction.mockResolvedValue([[med1], 1]);
      // 6 distinct prescribers with decreasing counts (6, 5, 4, 3, 2, 1)
      db.prescriptionItem.findMany.mockResolvedValue(
        Array.from({ length: 6 }, (_, i) =>
          Array(6 - i).fill({
            medication_id: 'med-1',
            prescription: {
              prescribed_by_id: `doc-${i}`,
              prescribed_by: {
                user: { first_name: `Doc${i}`, last_name: 'Test' },
              },
            },
          }),
        ).flat(),
      );
      db.medicalRepMedication.findMany.mockResolvedValue([]);

      const result = await service.findAll({}, mockUser);
      const item = result.items[0] as MedicationWithStatsDto;

      expect(item.top_prescribers).toHaveLength(5);
      expect(item.top_prescribers[0].count).toBeGreaterThanOrEqual(
        item.top_prescribers[1].count,
      );
    });

    it('attaches medical_reps from MedicalRepMedication', async () => {
      db.$transaction.mockResolvedValue([[med1], 1]);
      db.prescriptionItem.findMany.mockResolvedValue([]);
      db.medicalRepMedication.findMany.mockResolvedValue([
        {
          medication_id: 'med-1',
          medical_rep: {
            id: 'rep-1',
            full_name: 'Rep One',
            company_name: 'Pharma A',
          },
        },
        {
          medication_id: 'med-1',
          medical_rep: {
            id: 'rep-2',
            full_name: 'Rep Two',
            company_name: 'Pharma B',
          },
        },
      ]);

      const result = await service.findAll({}, mockUser);
      const item = result.items[0] as MedicationWithStatsDto;

      expect(item.medical_reps).toHaveLength(2);
      expect(item.medical_reps[0]).toEqual({
        id: 'rep-1',
        full_name: 'Rep One',
        company_name: 'Pharma A',
      });
    });

    it('returns empty page without making stats queries when no medications found', async () => {
      db.$transaction.mockResolvedValue([[], 0]);

      const result = await service.findAll({}, mockUser);

      expect(result.items).toEqual([]);
      expect(db.prescriptionItem.findMany).not.toHaveBeenCalled();
      expect(db.medicalRepMedication.findMany).not.toHaveBeenCalled();
    });

    it('does not drop org-scope filter when search term is provided', async () => {
      db.$transaction.mockResolvedValue([[med1], 1]);
      db.prescriptionItem.findMany.mockResolvedValue([]);
      db.medicalRepMedication.findMany.mockResolvedValue([]);

      await service.findAll({ search: 'drug' }, mockUser);

      const findManyCall = db.medication.findMany.mock.calls[0][0];
      expect(findManyCall.where).toHaveProperty('AND');
      expect(findManyCall.where.AND[0]).toHaveProperty('OR');
      expect(findManyCall.where.AND[0].OR).toContainEqual({
        organization_id: null,
      });
      expect(findManyCall.where.AND[0].OR).toContainEqual({
        organization_id: callerOrg,
      });
    });
  });
});
