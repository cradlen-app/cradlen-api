import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PatientsService } from './patients.service';
import { PrismaService } from '../../database/prisma.service';
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
    patientJourney: { findFirst: jest.Mock };
    patientEpisode: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    db = {
      patient: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      patientJourney: { findFirst: jest.fn() },
      patientEpisode: { findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatientsService,
        { provide: PrismaService, useValue: { db } },
      ],
    }).compile();
    service = module.get<PatientsService>(PatientsService);
  });

  describe('create', () => {
    it('creates a patient when national_id is unique', async () => {
      db.patient.findUnique.mockResolvedValue(null);
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
      expect(db.patient.create).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException when national_id already exists', async () => {
      db.patient.findUnique.mockResolvedValue(mockPatient);
      await expect(
        service.create({
          full_name: 'Sara Ali',
          husband_name: undefined,
          date_of_birth: '1990-01-01',
          national_id: '12345678',
          phone_number: '01012345678',
          address: 'Cairo',
        }),
      ).rejects.toThrow(ConflictException);
      expect(db.patient.create).not.toHaveBeenCalled();
    });
  });

  describe('lookup', () => {
    it('returns patient with episode summaries for non-clinical role', async () => {
      const mockActiveEpisodes = [
        { id: 'ep-uuid', name: 'First Trimester', order: 1 },
      ];
      db.patient.findUnique.mockResolvedValue(mockPatient);
      db.patientJourney.findFirst.mockResolvedValue({ id: 'journey-uuid' });
      db.patientEpisode.findMany.mockResolvedValue(mockActiveEpisodes);
      const result = await service.lookup('12345678', mockUser);
      expect(result).toMatchObject({ national_id: '12345678' });
      expect(
        (result as unknown as { active_episodes: unknown[] }).active_episodes,
      ).toEqual(mockActiveEpisodes);
    });

    it('throws NotFoundException when patient not found', async () => {
      db.patient.findUnique.mockResolvedValue(null);
      await expect(service.lookup('99999999', mockUser)).rejects.toThrow(
        NotFoundException,
      );
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
});
