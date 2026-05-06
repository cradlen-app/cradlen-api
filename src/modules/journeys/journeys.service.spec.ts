import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { JourneysService } from './journeys.service';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

const mockUser: AuthContext = {
  userId: 'user-uuid',
  profileId: 'profile-uuid',
  organizationId: 'org-uuid',
  roles: ['DOCTOR'],
  branchIds: ['branch-uuid'],
};

const mockTemplate = {
  id: 'tmpl-uuid',
  name: 'Pregnancy Journey',
  type: 'PREGNANCY',
  episodes: [
    { id: 'ept-1', name: 'First Trimester', order: 1 },
    { id: 'ept-2', name: 'Second Trimester', order: 2 },
  ],
};

const mockJourney = {
  id: 'journey-uuid',
  patient_id: 'patient-uuid',
  organization_id: 'org-uuid',
  journey_template_id: 'tmpl-uuid',
  status: 'ACTIVE',
  started_at: new Date(),
  ended_at: null,
  episodes: [],
};

describe('JourneysService', () => {
  let service: JourneysService;
  let db: {
    patient: { findUnique: jest.Mock };
    patientJourney: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    patientEpisode: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    journeyTemplate: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let prismaMock: {
    db: typeof db;
  };

  beforeEach(async () => {
    db = {
      patient: { findUnique: jest.fn() },
      patientJourney: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      patientEpisode: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      journeyTemplate: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    prismaMock = { db };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JourneysService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get<JourneysService>(JourneysService);
  });

  describe('create', () => {
    it('throws NotFoundException when patient does not exist', async () => {
      db.patient.findUnique.mockResolvedValue(null);
      await expect(
        service.create(
          'patient-uuid',
          { journey_template_id: 'tmpl-uuid' },
          mockUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when active journey of same type exists', async () => {
      db.patient.findUnique.mockResolvedValue({ id: 'patient-uuid' });
      db.patientJourney.findFirst.mockResolvedValue(mockJourney);
      await expect(
        service.create(
          'patient-uuid',
          { journey_template_id: 'tmpl-uuid' },
          mockUser,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when template does not exist', async () => {
      db.patient.findUnique.mockResolvedValue({ id: 'patient-uuid' });
      db.patientJourney.findFirst.mockResolvedValue(null);
      db.journeyTemplate.findUnique.mockResolvedValue(null);
      await expect(
        service.create(
          'patient-uuid',
          { journey_template_id: 'tmpl-uuid' },
          mockUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates journey and auto-creates episodes in transaction', async () => {
      db.patient.findUnique.mockResolvedValue({ id: 'patient-uuid' });
      db.patientJourney.findFirst.mockResolvedValue(null);
      db.journeyTemplate.findUnique.mockResolvedValue(mockTemplate);
      db.$transaction.mockResolvedValue(mockJourney);
      const result = await service.create(
        'patient-uuid',
        { journey_template_id: 'tmpl-uuid' },
        mockUser,
      );
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockJourney);
    });
  });

  describe('findOne', () => {
    it('returns journey when found and org matches', async () => {
      db.patientJourney.findUnique.mockResolvedValue(mockJourney);
      const result = await service.findOne('journey-uuid', mockUser);
      expect(result).toEqual(mockJourney);
    });

    it('throws NotFoundException when journey belongs to different org', async () => {
      db.patientJourney.findUnique.mockResolvedValue({
        ...mockJourney,
        organization_id: 'other-org',
      });
      await expect(service.findOne('journey-uuid', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateEpisodeStatus', () => {
    it('throws ForbiddenException when activating a PENDING episode while another is ACTIVE', async () => {
      const pendingEpisode = {
        id: 'ep-uuid',
        journey_id: 'journey-uuid',
        status: 'PENDING',
        order: 2,
      };
      db.patientJourney.findUnique.mockResolvedValue(mockJourney);
      db.patientEpisode.findUnique.mockResolvedValue(pendingEpisode);
      db.patientJourney.findFirst.mockResolvedValue({ id: 'journey-uuid' });
      await expect(
        service.updateEpisodeStatus(
          'journey-uuid',
          'ep-uuid',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { status: 'ACTIVE' as any },
          mockUser,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
