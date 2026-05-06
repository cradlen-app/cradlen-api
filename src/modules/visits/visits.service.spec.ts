import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VisitsService } from './visits.service';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

const mockUser: AuthContext = {
  userId: 'user-uuid',
  profileId: 'profile-uuid',
  organizationId: 'org-uuid',
  activeBranchId: 'branch-uuid',
  roles: ['RECEPTIONIST'],
  branchIds: ['branch-uuid'],
};

const mockEpisodeWithJourney = {
  id: 'ep-uuid',
  journey_id: 'journey-uuid',
  is_deleted: false,
  journey: { organization_id: 'org-uuid' },
};

const mockVisit = {
  id: 'visit-uuid',
  episode_id: 'ep-uuid',
  assigned_doctor_id: 'doctor-uuid',
  branch_id: 'branch-uuid',
  visit_type: 'FOLLOW_UP',
  priority: 'NORMAL',
  status: 'SCHEDULED',
  scheduled_at: new Date(),
  checked_in_at: null,
  started_at: null,
  completed_at: null,
  notes: null,
  created_by_id: 'profile-uuid',
  is_deleted: false,
  episode: { journey: { organization_id: 'org-uuid' } },
};

describe('VisitsService', () => {
  let service: VisitsService;
  let db: {
    patientEpisode: { findUnique: jest.Mock };
    visit: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let prismaMock: { db: typeof db };

  beforeEach(async () => {
    db = {
      patientEpisode: { findUnique: jest.fn() },
      visit: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    prismaMock = { db };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisitsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get<VisitsService>(VisitsService);
  });

  describe('create', () => {
    it('creates a visit when episode is in the user org', async () => {
      db.patientEpisode.findUnique.mockResolvedValue(mockEpisodeWithJourney);
      db.visit.create.mockResolvedValue(mockVisit);
      const result = await service.create(
        'ep-uuid',
        {
          assigned_doctor_id: 'doctor-uuid',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          visit_type: 'FOLLOW_UP' as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          priority: 'NORMAL' as any,
          scheduled_at: new Date().toISOString(),
        },
        mockUser,
      );
      expect(result).toEqual(mockVisit);
    });

    it('throws NotFoundException when episode is in a different org', async () => {
      db.patientEpisode.findUnique.mockResolvedValue({
        ...mockEpisodeWithJourney,
        journey: { organization_id: 'other-org' },
      });
      await expect(
        service.create(
          'ep-uuid',
          {
            assigned_doctor_id: 'doctor-uuid',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            visit_type: 'FOLLOW_UP' as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            priority: 'NORMAL' as any,
            scheduled_at: new Date().toISOString(),
          },
          mockUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAllForEpisode', () => {
    it('returns paginated visits for an episode in the user org', async () => {
      db.patientEpisode.findUnique.mockResolvedValue(mockEpisodeWithJourney);
      db.$transaction.mockResolvedValue([[mockVisit], 1]);
      const result = await service.findAllForEpisode('ep-uuid', mockUser, {
        page: 1,
        limit: 20,
      });
      expect(result.items).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('throws NotFoundException when episode is in a different org', async () => {
      db.patientEpisode.findUnique.mockResolvedValue({
        ...mockEpisodeWithJourney,
        journey: { organization_id: 'other-org' },
      });
      await expect(
        service.findAllForEpisode('ep-uuid', mockUser, {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('throws BadRequestException when updating a visit in a terminal status', async () => {
      db.visit.findUnique.mockResolvedValue({
        ...mockVisit,
        status: 'COMPLETED',
        episode: { journey: { organization_id: 'org-uuid' } },
      });
      await expect(
        service.update('visit-uuid', { notes: 'changed' }, mockUser),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateStatus', () => {
    it('throws BadRequestException on invalid status transition', async () => {
      db.visit.findUnique.mockResolvedValue({
        ...mockVisit,
        status: 'COMPLETED',
      });
      await expect(
        service.updateStatus(
          'visit-uuid',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { status: 'CHECKED_IN' as any },
          mockUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets checked_in_at when transitioning to CHECKED_IN', async () => {
      db.visit.findUnique.mockResolvedValue({
        ...mockVisit,
        status: 'SCHEDULED',
      });
      db.visit.update.mockResolvedValue({
        ...mockVisit,
        status: 'CHECKED_IN',
        checked_in_at: new Date(),
      });

      const result = await service.updateStatus(
        'visit-uuid',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { status: 'CHECKED_IN' as any },
        mockUser,
      );
      expect(db.visit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CHECKED_IN',
            checked_in_at: expect.any(Date),
          }),
        }),
      );
      expect(result.status).toBe('CHECKED_IN');
    });

    it('sets started_at when transitioning to IN_PROGRESS', async () => {
      db.visit.findUnique.mockResolvedValue({
        ...mockVisit,
        status: 'CHECKED_IN',
      });
      db.visit.update.mockResolvedValue({
        ...mockVisit,
        status: 'IN_PROGRESS',
        started_at: new Date(),
      });

      await service.updateStatus(
        'visit-uuid',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { status: 'IN_PROGRESS' as any },
        mockUser,
      );
      expect(db.visit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'IN_PROGRESS',
            started_at: expect.any(Date),
          }),
        }),
      );
    });

    it('sets completed_at when transitioning to COMPLETED', async () => {
      db.visit.findUnique.mockResolvedValue({
        ...mockVisit,
        status: 'IN_PROGRESS',
      });
      db.visit.update.mockResolvedValue({
        ...mockVisit,
        status: 'COMPLETED',
        completed_at: new Date(),
      });

      await service.updateStatus(
        'visit-uuid',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { status: 'COMPLETED' as any },
        mockUser,
      );
      expect(db.visit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'COMPLETED',
            completed_at: expect.any(Date),
          }),
        }),
      );
    });
  });
});
