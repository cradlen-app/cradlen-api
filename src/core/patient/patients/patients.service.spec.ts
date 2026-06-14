import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PatientsService } from './patients.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { StorageService } from '@infrastructure/storage/storage.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.public.js';
import { AuthContext } from '@common/interfaces/auth-context.interface.js';

const mockUser: AuthContext = {
  userId: 'user-uuid',
  profileId: 'profile-uuid',
  organizationId: 'org-uuid',
  roles: ['RECEPTIONIST'],
  branchIds: ['branch-uuid'],
};

const mockPatient = {
  id: 'patient-uuid',
  national_id: '12345678',
  full_name: 'Sara Ali',
  date_of_birth: new Date('1990-01-01'),
  phone_number: '01012345678',
  address: 'Cairo',
  is_deleted: false,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('PatientsService', () => {
  let service: PatientsService;
  let db: {
    patient: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    profileJobFunction: { findFirst: jest.Mock };
    visit: { findMany: jest.Mock };
    patientJourney: { groupBy: jest.Mock };
    journeyTemplate: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let authMock: {
    assertCanAccessBranch: jest.Mock;
    assertCanManageOrganization: jest.Mock;
    isClinical: jest.Mock;
  };
  let accessMock: { assertPatientAccessible: jest.Mock };

  beforeEach(async () => {
    db = {
      patient: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      // Non-clinical caller by default (no clinical job function).
      profileJobFunction: { findFirst: jest.fn().mockResolvedValue(null) },
      visit: { findMany: jest.fn().mockResolvedValue([]) },
      patientJourney: { groupBy: jest.fn().mockResolvedValue([]) },
      journeyTemplate: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };
    authMock = {
      assertCanAccessBranch: jest.fn(),
      assertCanManageOrganization: jest.fn(),
      isClinical: jest.fn().mockResolvedValue(false),
    };
    accessMock = {
      assertPatientAccessible: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatientsService,
        { provide: PrismaService, useValue: { db } },
        { provide: AuthorizationService, useValue: authMock },
        { provide: PatientAccessService, useValue: accessMock },
        {
          provide: StorageService,
          useValue: {
            createPresignedDownloadUrl: jest
              .fn()
              .mockResolvedValue('https://signed/url'),
          },
        },
      ],
    }).compile();
    service = module.get<PatientsService>(PatientsService);
  });

  describe('create', () => {
    it('calls patient.create with correct data', async () => {
      db.patient.create.mockResolvedValue(mockPatient);
      const result = await service.create({
        full_name: 'Sara Ali',
        date_of_birth: '1990-01-01',
        national_id: '12345678',
        phone_number: '01012345678',
        address: 'Cairo',
      });
      expect(result).toEqual(mockPatient);
      expect(db.patient.create).toHaveBeenCalledWith({
        data: {
          full_name: 'Sara Ali',
          date_of_birth: new Date('1990-01-01'),
          national_id: '12345678',
          phone_number: '01012345678',
          address: 'Cairo',
        },
      });
    });
  });

  describe('findAll', () => {
    const mockEpisodes = [
      { id: 'ep-uuid', name: 'First Trimester', order: 1, is_deleted: false },
    ];
    const mockJourney = {
      id: 'journey-uuid',
      status: 'ACTIVE',
      episodes: mockEpisodes,
    };
    const patientWithJourney = {
      ...mockPatient,
      journeys: [mockJourney],
    };
    const patientNoJourney = {
      ...mockPatient,
      journeys: [],
    };

    it('passes enrollment filter (ACTIVE/DISCHARGED) to findMany and count', async () => {
      db.$transaction.mockResolvedValue([[], 0]);
      await service.findAll({}, mockUser);

      const enrollmentFilter = {
        enrollments: {
          some: {
            organization_id: mockUser.organizationId,
            status: { in: ['ACTIVE', 'DISCHARGED'] },
            is_deleted: false,
          },
        },
      };

      expect(db.patient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining(enrollmentFilter),
        }),
      );
      expect(db.patient.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining(enrollmentFilter),
        }),
      );
    });

    it('returns episode summaries (id, name, order) for non-clinical viewers', async () => {
      db.$transaction.mockResolvedValue([[patientWithJourney], 1]);
      const result = await service.findAll({}, mockUser);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const first = (result as any).items[0];
      expect(first.active_episodes).toEqual([
        { id: 'ep-uuid', name: 'First Trimester', order: 1 },
      ]);
      expect(first.active_journey).toBeUndefined();
    });

    it('returns empty active_episodes when patient has no active journey', async () => {
      db.$transaction.mockResolvedValue([[patientNoJourney], 1]);
      const result = await service.findAll({}, mockUser);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).items[0].active_episodes).toEqual([]);
    });

    it('returns full active_journey with episodes for OWNER role', async () => {
      const ownerUser: AuthContext = { ...mockUser, roles: ['OWNER'] };
      db.$transaction.mockResolvedValue([[patientWithJourney], 1]);
      const result = await service.findAll({}, ownerUser);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const first = (result as any).items[0];
      expect(first.active_journey).toMatchObject({ id: 'journey-uuid' });
      expect(first.active_journey.episodes).toEqual(mockEpisodes);
      expect(first.active_episodes).toBeUndefined();
      // OWNER short-circuits — no clinical lookup needed.
      expect(authMock.isClinical).not.toHaveBeenCalled();
    });

    it('returns full active_journey for a caller with a clinical job function', async () => {
      authMock.isClinical.mockResolvedValue(true);
      db.$transaction.mockResolvedValue([[patientWithJourney], 1]);
      const result = await service.findAll({}, mockUser);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const first = (result as any).items[0];
      expect(first.active_journey).toMatchObject({ id: 'journey-uuid' });
      expect(first.active_episodes).toBeUndefined();
      expect(authMock.isClinical).toHaveBeenCalledWith(mockUser.profileId);
    });

    it('returns active_journey: null for a clinical viewer when patient has no active journey', async () => {
      authMock.isClinical.mockResolvedValue(true);
      db.$transaction.mockResolvedValue([[patientNoJourney], 1]);
      const result = await service.findAll({}, mockUser);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).items[0].active_journey).toBeNull();
    });
  });

  describe('findOne', () => {
    it('asserts branch-gated access before returning the patient', async () => {
      db.patient.findUnique.mockResolvedValue({ ...mockPatient });
      await service.findOne('patient-uuid', mockUser);
      expect(accessMock.assertPatientAccessible).toHaveBeenCalledWith(
        'patient-uuid',
        mockUser,
      );
    });

    it('returns patient when found', async () => {
      db.patient.findUnique.mockResolvedValue({ ...mockPatient });
      const result = await service.findOne('patient-uuid', mockUser);
      expect(result).toMatchObject({
        id: mockPatient.id,
        full_name: mockPatient.full_name,
      });
    });

    it('propagates NotFoundException for a patient the caller cannot access', async () => {
      accessMock.assertPatientAccessible.mockRejectedValue(
        new NotFoundException('Patient bad-id not found'),
      );
      await expect(service.findOne('bad-id', mockUser)).rejects.toThrow(
        NotFoundException,
      );
      expect(db.patient.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when not found', async () => {
      db.patient.findUnique.mockResolvedValue(null);
      await expect(service.findOne('bad-id', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('asserts branch-gated access before updating', async () => {
      accessMock.assertPatientAccessible.mockRejectedValue(
        new NotFoundException('Patient bad-id not found'),
      );
      await expect(
        service.update('bad-id', { full_name: 'X' }, mockUser),
      ).rejects.toThrow(NotFoundException);
      expect(db.patient.update).not.toHaveBeenCalled();
    });
  });

  describe('findAllForBranch', () => {
    const mockJourneyTemplate = { type: 'PREGNANCY' };
    const mockJourney = {
      id: 'journey-uuid',
      status: 'ACTIVE',
      journey_template: mockJourneyTemplate,
    };
    const patientWithJourney = {
      ...mockPatient,
      journeys: [mockJourney],
    };
    const patientNoJourney = {
      ...mockPatient,
      journeys: [],
    };

    it('throws ForbiddenException when assertCanAccessBranch rejects', async () => {
      authMock.assertCanAccessBranch.mockRejectedValue(
        new ForbiddenException('Branch access denied'),
      );
      await expect(
        service.findAllForBranch('branch-uuid', {}, mockUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns paginated patients with journey when found', async () => {
      authMock.assertCanAccessBranch.mockResolvedValue(undefined);
      db.$transaction.mockResolvedValue([[patientWithJourney], 1]);
      const result = await service.findAllForBranch(
        'branch-uuid',
        {},
        mockUser,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const first = (result as any).items[0];
      expect(first.journey).toEqual({
        id: 'journey-uuid',
        type: 'PREGNANCY',
        status: 'ACTIVE',
      });
    });

    it('narrows the directory to the doctor when assigned_to_me is set', async () => {
      authMock.assertCanAccessBranch.mockResolvedValue(undefined);
      db.$transaction.mockResolvedValue([[], 0]);

      await service.findAllForBranch(
        'branch-uuid',
        { assigned_to_me: true },
        mockUser,
      );

      const where = db.patient.findMany.mock.calls[0][0].where;
      expect(
        where.journeys.some.episodes.some.visits.some.assigned_doctor_id,
      ).toBe(mockUser.profileId);
    });

    it('stays branch-wide (no doctor filter) when assigned_to_me is absent', async () => {
      authMock.assertCanAccessBranch.mockResolvedValue(undefined);
      db.$transaction.mockResolvedValue([[], 0]);

      await service.findAllForBranch('branch-uuid', {}, mockUser);

      const where = db.patient.findMany.mock.calls[0][0].where;
      expect(
        where.journeys.some.episodes.some.visits.some.assigned_doctor_id,
      ).toBeUndefined();
    });

    it('returns journey: null when patient has no matching journey', async () => {
      authMock.assertCanAccessBranch.mockResolvedValue(undefined);
      db.$transaction.mockResolvedValue([[patientNoJourney], 1]);
      const result = await service.findAllForBranch(
        'branch-uuid',
        {},
        mockUser,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).items[0].journey).toBeNull();
    });

    it('calls assertCanAccessBranch with profileId and branchId', async () => {
      authMock.assertCanAccessBranch.mockResolvedValue(undefined);
      db.$transaction.mockResolvedValue([[], 0]);
      await service.findAllForBranch('branch-uuid', {}, mockUser);
      expect(authMock.assertCanAccessBranch).toHaveBeenCalledWith(
        'profile-uuid',
        mockUser.organizationId,
        'branch-uuid',
      );
    });

    it('returns last_visit_date from most recent completed visit', async () => {
      authMock.assertCanAccessBranch.mockResolvedValue(undefined);
      db.$transaction.mockResolvedValue([[patientWithJourney], 1]);
      const lastDate = new Date('2026-04-01');
      db.visit.findMany.mockResolvedValue([
        {
          scheduled_at: lastDate,
          episode: { journey: { patient_id: 'patient-uuid' } },
        },
      ]);
      const result = await service.findAllForBranch(
        'branch-uuid',
        {},
        mockUser,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).items[0].last_visit_date).toEqual(lastDate);
    });

    it('returns last_visit_date: null when no completed visits exist', async () => {
      authMock.assertCanAccessBranch.mockResolvedValue(undefined);
      db.$transaction.mockResolvedValue([[patientWithJourney], 1]);
      db.visit.findMany.mockResolvedValue([]);
      const result = await service.findAllForBranch(
        'branch-uuid',
        {},
        mockUser,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).items[0].last_visit_date).toBeNull();
    });
  });

  describe('getBranchStats', () => {
    // Two templates from two different specialties — proves the breakdown is
    // discovered from data, not bound to a hardcoded enum.
    const templates = [
      {
        id: 'tpl-preg',
        name: 'Pregnancy',
        type: 'PREGNANCY',
        specialty: { id: 'spec-obgyn', name: 'OB/GYN' },
      },
      {
        id: 'tpl-derm',
        name: 'Acne Follow-up',
        type: 'CHRONIC_CONDITION',
        specialty: { id: 'spec-derm', name: 'Dermatology' },
      },
    ];

    beforeEach(() => {
      authMock.assertCanAccessBranch.mockResolvedValue(undefined);
      db.patientJourney.groupBy.mockResolvedValue([
        { journey_template_id: 'tpl-preg' },
        { journey_template_id: 'tpl-derm' },
      ]);
      db.journeyTemplate.findMany.mockResolvedValue(templates);
    });

    it('asserts branch access before computing stats', async () => {
      authMock.assertCanAccessBranch.mockRejectedValue(
        new ForbiddenException('Branch access denied'),
      );
      await expect(
        service.getBranchStats('branch-uuid', mockUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns total + a data-driven per-care-path breakdown, sorted desc', async () => {
      // [totalCur, totalPrev, totalPrevPrev, preg cur/prev, derm cur/prev]
      db.$transaction.mockResolvedValue([10, 7, 5, 4, 3, 6, 5]);

      const result = await service.getBranchStats('branch-uuid', mockUser);

      expect(result.total).toEqual({ current: 10, previous: 7 });
      // new this month = 10 - 7; new last month = 7 - 5.
      expect(result.new_this_month).toEqual({ current: 3, previous: 2 });
      expect(result.by_care_path).toEqual([
        {
          journey_template_id: 'tpl-derm',
          name: 'Acne Follow-up',
          specialty_id: 'spec-derm',
          specialty_name: 'Dermatology',
          type: 'CHRONIC_CONDITION',
          current: 6,
          previous: 5,
        },
        {
          journey_template_id: 'tpl-preg',
          name: 'Pregnancy',
          specialty_id: 'spec-obgyn',
          specialty_name: 'OB/GYN',
          type: 'PREGNANCY',
          current: 4,
          previous: 3,
        },
      ]);
    });

    it('drops care paths with a zero current count', async () => {
      db.$transaction.mockResolvedValue([4, 2, 1, 4, 2, 0, 0]);
      const result = await service.getBranchStats('branch-uuid', mockUser);
      expect(result.by_care_path).toHaveLength(1);
      expect(result.by_care_path[0].journey_template_id).toBe('tpl-preg');
    });

    it('returns an empty breakdown when no journeys are present', async () => {
      db.patientJourney.groupBy.mockResolvedValue([]);
      db.journeyTemplate.findMany.mockResolvedValue([]);
      db.$transaction.mockResolvedValue([0, 0, 0]);
      const result = await service.getBranchStats('branch-uuid', mockUser);
      expect(result.by_care_path).toEqual([]);
      expect(db.journeyTemplate.findMany).not.toHaveBeenCalled();
    });

    it('narrows to the doctor when assigned_to_me is set', async () => {
      db.$transaction.mockResolvedValue([2, 1, 0, 2, 1, 0, 0]);

      await service.getBranchStats('branch-uuid', mockUser, true);

      const where = db.patientJourney.groupBy.mock.calls[0][0].where;
      expect(where.episodes.some.visits.some.assigned_doctor_id).toBe(
        mockUser.profileId,
      );
    });

    it('does not filter by doctor by default', async () => {
      db.$transaction.mockResolvedValue([2, 1, 0, 2, 1, 0, 0]);

      await service.getBranchStats('branch-uuid', mockUser);

      const where = db.patientJourney.groupBy.mock.calls[0][0].where;
      expect(
        where.episodes.some.visits.some.assigned_doctor_id,
      ).toBeUndefined();
    });
  });
});
