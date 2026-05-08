import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PatientsService } from './patients.service';
import { PrismaService } from '../../database/prisma.service';
import { AuthorizationService } from '../../common/authorization/authorization.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

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
  husband_name: 'Ahmed Ali',
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
    visit: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let authMock: { assertCanAccessBranch: jest.Mock };

  beforeEach(async () => {
    db = {
      patient: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      visit: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };
    authMock = { assertCanAccessBranch: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatientsService,
        { provide: PrismaService, useValue: { db } },
        { provide: AuthorizationService, useValue: authMock },
      ],
    }).compile();
    service = module.get<PatientsService>(PatientsService);
  });

  describe('create', () => {
    it('calls patient.create with correct data', async () => {
      db.patient.create.mockResolvedValue(mockPatient);
      const result = await service.create({
        full_name: 'Sara Ali',
        husband_name: 'Ahmed Ali',
        date_of_birth: '1990-01-01',
        national_id: '12345678',
        phone_number: '01012345678',
        address: 'Cairo',
      });
      expect(result).toEqual(mockPatient);
      expect(db.patient.create).toHaveBeenCalledWith({
        data: {
          full_name: 'Sara Ali',
          husband_name: 'Ahmed Ali',
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
    const patientWithJourney = { ...mockPatient, journeys: [mockJourney] };
    const patientNoJourney = { ...mockPatient, journeys: [] };

    it('returns episode summaries (id, name, order) for non-clinical roles', async () => {
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

    it('returns full active_journey with episodes for DOCTOR role', async () => {
      const doctorUser: AuthContext = { ...mockUser, roles: ['DOCTOR'] };
      db.$transaction.mockResolvedValue([[patientWithJourney], 1]);
      const result = await service.findAll({}, doctorUser);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const first = (result as any).items[0];
      expect(first.active_journey).toMatchObject({ id: 'journey-uuid' });
      expect(first.active_journey.episodes).toEqual(mockEpisodes);
      expect(first.active_episodes).toBeUndefined();
    });

    it('returns active_journey: null for DOCTOR when patient has no active journey', async () => {
      const doctorUser: AuthContext = { ...mockUser, roles: ['DOCTOR'] };
      db.$transaction.mockResolvedValue([[patientNoJourney], 1]);
      const result = await service.findAll({}, doctorUser);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).items[0].active_journey).toBeNull();
    });
  });

  describe('findOne', () => {
    it('returns patient when found', async () => {
      db.patient.findUnique.mockResolvedValue(mockPatient);
      const result = await service.findOne('patient-uuid');
      expect(result).toEqual(mockPatient);
    });

    it('throws NotFoundException when not found', async () => {
      db.patient.findUnique.mockResolvedValue(null);
      await expect(service.findOne('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAllForBranch', () => {
    const mockJourneyTemplate = { type: 'PREGNANCY' };
    const mockJourney = {
      id: 'journey-uuid',
      status: 'ACTIVE',
      journey_template: mockJourneyTemplate,
    };
    const patientWithJourney = { ...mockPatient, journeys: [mockJourney] };
    const patientNoJourney = { ...mockPatient, journeys: [] };

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
