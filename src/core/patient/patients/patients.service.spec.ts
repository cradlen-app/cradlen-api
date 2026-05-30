import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PatientsService } from './patients.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
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
    $transaction: jest.Mock;
  };
  let authMock: { assertCanAccessBranch: jest.Mock };
  let accessMock: { assertPatientInOrg: jest.Mock };

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
      $transaction: jest.fn(),
    };
    authMock = { assertCanAccessBranch: jest.fn() };
    accessMock = { assertPatientInOrg: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatientsService,
        { provide: PrismaService, useValue: { db } },
        { provide: AuthorizationService, useValue: authMock },
        { provide: PatientAccessService, useValue: accessMock },
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
      guardian_links: [],
    };
    const patientNoJourney = {
      ...mockPatient,
      journeys: [],
      guardian_links: [],
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
      // OWNER short-circuits — no job-function lookup needed.
      expect(db.profileJobFunction.findFirst).not.toHaveBeenCalled();
    });

    it('returns full active_journey for a caller with a clinical job function', async () => {
      db.profileJobFunction.findFirst.mockResolvedValue({ id: 'pjf-uuid' });
      db.$transaction.mockResolvedValue([[patientWithJourney], 1]);
      const result = await service.findAll({}, mockUser);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const first = (result as any).items[0];
      expect(first.active_journey).toMatchObject({ id: 'journey-uuid' });
      expect(first.active_episodes).toBeUndefined();
      expect(db.profileJobFunction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            profile_id: mockUser.profileId,
            job_function: { is_clinical: true },
          }),
        }),
      );
    });

    it('returns active_journey: null for a clinical viewer when patient has no active journey', async () => {
      db.profileJobFunction.findFirst.mockResolvedValue({ id: 'pjf-uuid' });
      db.$transaction.mockResolvedValue([[patientNoJourney], 1]);
      const result = await service.findAll({}, mockUser);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).items[0].active_journey).toBeNull();
    });
  });

  describe('findOne', () => {
    it('asserts org access before returning the patient', async () => {
      db.patient.findUnique.mockResolvedValue({
        ...mockPatient,
        guardian_links: [],
      });
      await service.findOne('patient-uuid', mockUser);
      expect(accessMock.assertPatientInOrg).toHaveBeenCalledWith(
        'patient-uuid',
        mockUser,
      );
    });

    it('returns patient when found (no spouse)', async () => {
      db.patient.findUnique.mockResolvedValue({
        ...mockPatient,
        guardian_links: [],
      });
      const result = await service.findOne('patient-uuid', mockUser);
      expect(result).toMatchObject({
        id: mockPatient.id,
        full_name: mockPatient.full_name,
      });
    });

    it('returns patient with flat spouse fields when spouse linked', async () => {
      const spouseGuardian = {
        id: 'guardian-uuid',
        full_name: 'Ahmed Ali',
        national_id: '99999',
        phone_number: '0101',
      };
      db.patient.findUnique.mockResolvedValue({
        ...mockPatient,
        guardian_links: [{ guardian: spouseGuardian }],
      });
      const result = await service.findOne('patient-uuid', mockUser);
      expect(result).toMatchObject({
        spouse_guardian_id: spouseGuardian.id,
        spouse_full_name: spouseGuardian.full_name,
        spouse_national_id: spouseGuardian.national_id,
        spouse_phone_number: spouseGuardian.phone_number,
      });
    });

    it('propagates NotFoundException for a patient outside the caller org', async () => {
      accessMock.assertPatientInOrg.mockRejectedValue(
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
    it('asserts org access before updating', async () => {
      accessMock.assertPatientInOrg.mockRejectedValue(
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
      guardian_links: [],
    };
    const patientNoJourney = {
      ...mockPatient,
      journeys: [],
      guardian_links: [],
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
});
