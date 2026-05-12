import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { VisitsService } from './visits.service';
import { EventBus } from '@infrastructure/messaging/event-bus';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';

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
  appointment_type: 'FOLLOW_UP',
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

const mockTemplate = {
  id: 'template-uuid',
  type: 'GENERAL_GYN',
  is_deleted: false,
  episodes: [
    {
      id: 'ep-template-uuid',
      name: 'General Consultation',
      order: 1,
      is_deleted: false,
    },
  ],
};

const mockPatient = {
  id: 'patient-uuid',
  national_id: '12345',
  full_name: 'Jane Doe',
  is_deleted: false,
};

const mockJourney = {
  id: 'journey-uuid',
  patient_id: 'patient-uuid',
  organization_id: 'org-uuid',
  is_deleted: false,
  status: 'ACTIVE',
};

const mockEpisode = {
  id: 'gen-ep-uuid',
  journey_id: 'journey-uuid',
  episode_template_id: 'ep-template-uuid',
  is_deleted: false,
};

describe('VisitsService', () => {
  let service: VisitsService;
  let eventBusMock: { publish: jest.Mock };
  let db: {
    patientEpisode: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      createMany: jest.Mock;
    };
    patient: { findUnique: jest.Mock; create: jest.Mock };
    patientJourney: { findFirst: jest.Mock; create: jest.Mock };
    journeyTemplate: { findFirst: jest.Mock };
    visit: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    branch: { findFirst: jest.Mock };
    visitEncounter: { findUnique: jest.Mock; upsert: jest.Mock };
    visitVitals: { upsert: jest.Mock };
    $transaction: jest.Mock;
  };
  let prismaMock: { db: typeof db };

  beforeEach(async () => {
    db = {
      patientEpisode: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        createMany: jest.fn(),
      },
      patient: { findUnique: jest.fn(), create: jest.fn() },
      patientJourney: { findFirst: jest.fn(), create: jest.fn() },
      journeyTemplate: { findFirst: jest.fn() },
      visit: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      branch: { findFirst: jest.fn() },
      visitEncounter: { findUnique: jest.fn(), upsert: jest.fn() },
      visitVitals: { upsert: jest.fn() },
      $transaction: jest.fn(),
    };
    prismaMock = { db };
    eventBusMock = { publish: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisitsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EventBus, useValue: eventBusMock },
      ],
    }).compile();
    service = module.get<VisitsService>(VisitsService);
  });

  describe('create', () => {
    it('creates a visit when episode is in the user org', async () => {
      db.patientEpisode.findUnique.mockResolvedValue(mockEpisodeWithJourney);
      db.visit.create.mockResolvedValue(mockVisit);
      db.$transaction.mockImplementation(
        async (cb: (tx: typeof db) => Promise<unknown>) => cb(db),
      );
      const result = await service.create(
        'ep-uuid',
        {
          assigned_doctor_id: 'doctor-uuid',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          appointment_type: 'FOLLOW_UP' as any,
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
            appointment_type: 'FOLLOW_UP' as any,
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
        service.update('visit-uuid', { chief_complaint: 'changed' }, mockUser),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateStatus', () => {
    beforeEach(() => {
      db.$transaction.mockImplementation(
        async (cb: (tx: typeof db) => Promise<unknown>) => cb(db),
      );
      db.visit.findFirst.mockResolvedValue(null);
    });

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

    it('sets checked_in_at and queue_number when transitioning to CHECKED_IN', async () => {
      db.visit.findUnique.mockResolvedValue({
        ...mockVisit,
        status: 'SCHEDULED',
      });
      db.visit.update.mockResolvedValue({
        ...mockVisit,
        status: 'CHECKED_IN',
        checked_in_at: new Date(),
        queue_number: 1,
        assigned_doctor_id: 'doctor-uuid',
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
            queue_number: 1,
          }),
        }),
      );
      expect(result.status).toBe('CHECKED_IN');
      expect(result.queue_number).toBe(1);
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
        assigned_doctor_id: 'doctor-uuid',
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

    it('rejects COMPLETED transition when no encounter exists', async () => {
      db.visit.findUnique.mockResolvedValue({
        ...mockVisit,
        status: 'IN_PROGRESS',
      });
      db.visitEncounter.findUnique.mockResolvedValue(null);
      await expect(
        service.updateStatus(
          'visit-uuid',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { status: 'COMPLETED' as any },
          mockUser,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(db.visit.update).not.toHaveBeenCalled();
    });

    it('rejects COMPLETED transition when chief_complaint is empty', async () => {
      db.visit.findUnique.mockResolvedValue({
        ...mockVisit,
        status: 'IN_PROGRESS',
      });
      db.visitEncounter.findUnique.mockResolvedValue({
        chief_complaint: '   ', // whitespace only
      });
      await expect(
        service.updateStatus(
          'visit-uuid',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { status: 'COMPLETED' as any },
          mockUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets completed_at when transitioning to COMPLETED', async () => {
      db.visit.findUnique.mockResolvedValue({
        ...mockVisit,
        status: 'IN_PROGRESS',
      });
      db.visitEncounter.findUnique.mockResolvedValue({
        chief_complaint: 'Bleeding',
      });
      db.visit.update.mockResolvedValue({
        ...mockVisit,
        status: 'COMPLETED',
        completed_at: new Date(),
        assigned_doctor_id: 'doctor-uuid',
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

    it('emits visit.status_updated WebSocket event after status update', async () => {
      db.visit.findUnique.mockResolvedValue({
        ...mockVisit,
        status: 'SCHEDULED',
      });
      db.visit.update.mockResolvedValue({
        ...mockVisit,
        status: 'CHECKED_IN',
        checked_in_at: new Date(),
        assigned_doctor_id: 'doctor-uuid',
      });

      await service.updateStatus(
        'visit-uuid',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { status: 'CHECKED_IN' as any },
        mockUser,
      );

      expect(eventBusMock.publish).toHaveBeenCalledWith(
        'visit.status_updated',
        expect.objectContaining({
          assignedDoctorId: 'doctor-uuid',
          branchId: 'branch-uuid',
          payload: expect.any(Object),
        }),
      );
    });
  });

  describe('bookVisit', () => {
    const baseDto = {
      national_id: '12345',
      full_name: 'Jane Doe',
      date_of_birth: '1990-01-01',
      phone_number: '0500000000',
      address: '123 Main St',
      assigned_doctor_id: 'doctor-uuid',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      appointment_type: 'VISIT' as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      priority: 'NORMAL' as any,
      scheduled_at: new Date().toISOString(),
    };

    beforeEach(() => {
      db.$transaction.mockImplementation(
        async (cb: (tx: typeof db) => Promise<unknown>) => cb(db),
      );
    });

    it('throws BadRequestException when patient_id absent and required patient fields missing', async () => {
      await expect(
        service.bookVisit(
          {
            assigned_doctor_id: 'doc',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            appointment_type: 'VISIT' as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            priority: 'NORMAL' as any,
            scheduled_at: new Date().toISOString(),
          },
          mockUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when is_married=true but husband_name missing', async () => {
      db.journeyTemplate.findFirst.mockResolvedValue(mockTemplate);
      await expect(
        service.bookVisit({ ...baseDto, is_married: true }, mockUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when branch_id absent and user has no activeBranchId', async () => {
      db.journeyTemplate.findFirst.mockResolvedValue(mockTemplate);
      const userNoBranch = { ...mockUser, activeBranchId: undefined };
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        service.bookVisit(baseDto, userNoBranch as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when GENERAL_GYN template not found', async () => {
      db.journeyTemplate.findFirst.mockResolvedValue(null);
      await expect(service.bookVisit(baseDto, mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when patient_id provided but patient not found', async () => {
      db.journeyTemplate.findFirst.mockResolvedValue(mockTemplate);
      db.patient.findUnique.mockResolvedValue(null);
      await expect(
        service.bookVisit(
          { ...baseDto, patient_id: 'nonexistent-uuid' },
          mockUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when new patient has duplicate national_id', async () => {
      db.journeyTemplate.findFirst.mockResolvedValue(mockTemplate);
      db.patient.findUnique.mockResolvedValue({
        ...mockPatient,
        is_deleted: false,
      });
      await expect(service.bookVisit(baseDto, mockUser)).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates new patient, journey, episodes and visit on first walk-in', async () => {
      db.journeyTemplate.findFirst.mockResolvedValue(mockTemplate);
      db.patient.findUnique.mockResolvedValue(null);
      db.patient.create.mockResolvedValue(mockPatient);
      db.patientJourney.findFirst.mockResolvedValue(null);
      db.patientJourney.create.mockResolvedValue(mockJourney);
      db.patientEpisode.createMany.mockResolvedValue({ count: 1 });
      db.patientEpisode.findFirst.mockResolvedValue(mockEpisode);
      db.visit.create.mockResolvedValue({
        ...mockVisit,
        episode_id: 'gen-ep-uuid',
      });

      await service.bookVisit(baseDto, mockUser);

      expect(db.patient.create).toHaveBeenCalledTimes(1);
      expect(db.patientJourney.create).toHaveBeenCalledTimes(1);
      expect(db.patientEpisode.createMany).toHaveBeenCalledTimes(1);
      expect(db.visit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ episode_id: 'gen-ep-uuid' }),
        }),
      );
    });

    it('reuses existing journey episode on second walk-in', async () => {
      db.journeyTemplate.findFirst.mockResolvedValue(mockTemplate);
      db.patient.findUnique.mockResolvedValueOnce(null); // national_id check
      db.patient.create.mockResolvedValue(mockPatient);
      db.patientJourney.findFirst.mockResolvedValue(mockJourney);
      db.patientEpisode.findFirst.mockResolvedValue(mockEpisode);
      db.visit.create.mockResolvedValue({
        ...mockVisit,
        episode_id: 'gen-ep-uuid',
      });

      await service.bookVisit(baseDto, mockUser);

      expect(db.patientJourney.create).not.toHaveBeenCalled();
      expect(db.visit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ episode_id: 'gen-ep-uuid' }),
        }),
      );
    });

    it('stores husband_name as null when is_married=false', async () => {
      db.journeyTemplate.findFirst.mockResolvedValue(mockTemplate);
      db.patient.findUnique.mockResolvedValue(null);
      db.patient.create.mockResolvedValue(mockPatient);
      db.patientJourney.findFirst.mockResolvedValue(null);
      db.patientJourney.create.mockResolvedValue(mockJourney);
      db.patientEpisode.createMany.mockResolvedValue({ count: 1 });
      db.patientEpisode.findFirst.mockResolvedValue(mockEpisode);
      db.visit.create.mockResolvedValue(mockVisit);

      await service.bookVisit(
        { ...baseDto, is_married: false, husband_name: 'Ahmed' },
        mockUser,
      );

      expect(db.patient.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ husband_name: null }),
        }),
      );
    });

    it('stores husband_name when is_married=true and husband_name provided', async () => {
      db.journeyTemplate.findFirst.mockResolvedValue(mockTemplate);
      db.patient.findUnique.mockResolvedValue(null);
      db.patient.create.mockResolvedValue(mockPatient);
      db.patientJourney.findFirst.mockResolvedValue(null);
      db.patientJourney.create.mockResolvedValue(mockJourney);
      db.patientEpisode.createMany.mockResolvedValue({ count: 1 });
      db.patientEpisode.findFirst.mockResolvedValue(mockEpisode);
      db.visit.create.mockResolvedValue(mockVisit);

      await service.bookVisit(
        { ...baseDto, is_married: true, husband_name: 'Ahmed' },
        mockUser,
      );

      expect(db.patient.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ husband_name: 'Ahmed' }),
        }),
      );
    });

    it('emits visit.booked WebSocket event after successful booking', async () => {
      db.journeyTemplate.findFirst.mockResolvedValue(mockTemplate);
      db.patient.findUnique.mockResolvedValue(null);
      db.patient.create.mockResolvedValue(mockPatient);
      db.patientJourney.findFirst.mockResolvedValue(null);
      db.patientJourney.create.mockResolvedValue(mockJourney);
      db.patientEpisode.createMany.mockResolvedValue({ count: 1 });
      db.patientEpisode.findFirst.mockResolvedValue(mockEpisode);
      db.visit.create.mockResolvedValue({
        ...mockVisit,
        assigned_doctor_id: 'doctor-uuid',
      });

      await service.bookVisit(baseDto, mockUser);

      expect(eventBusMock.publish).toHaveBeenCalledWith(
        'visit.booked',
        expect.objectContaining({
          assignedDoctorId: 'doctor-uuid',
          branchId: 'branch-uuid',
          payload: expect.any(Object),
        }),
      );
    });
  });

  describe('findAllForBranch', () => {
    const ownerUser: AuthContext = {
      userId: 'user-uuid',
      profileId: 'profile-uuid',
      organizationId: 'org-uuid',
      activeBranchId: 'branch-uuid',
      roles: ['OWNER'],
      branchIds: ['branch-uuid'],
    };

    const doctorUser: AuthContext = {
      userId: 'user-uuid-2',
      profileId: 'profile-uuid-2',
      organizationId: 'org-uuid',
      activeBranchId: 'branch-uuid',
      roles: ['DOCTOR'],
      branchIds: ['branch-uuid'],
    };

    const outsiderUser: AuthContext = {
      userId: 'user-uuid-3',
      profileId: 'profile-uuid-3',
      organizationId: 'org-uuid',
      activeBranchId: 'other-branch',
      roles: ['DOCTOR'],
      branchIds: ['other-branch'],
    };

    const mockBranch = { id: 'branch-uuid' };

    const mockVisitRow = {
      id: 'visit-uuid',
      appointment_type: 'VISIT',
      priority: 'NORMAL',
      status: 'SCHEDULED',
      scheduled_at: new Date(),
      notes: null,
      assigned_doctor: {
        id: 'doctor-uuid',
        specialty: 'Gynecology',
        user: { id: 'user-uuid', first_name: 'Ahmed', last_name: 'Ali' },
      },
      episode: {
        id: 'ep-uuid',
        journey: {
          patient: { id: 'patient-uuid', full_name: 'Fatima Hassan' },
        },
      },
    };

    it('returns paginated visits for OWNER', async () => {
      db.branch.findFirst.mockResolvedValue(mockBranch);
      db.$transaction.mockResolvedValue([[mockVisitRow], 1]);
      const result = await service.findAllForBranch(
        'branch-uuid',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'SCHEDULED' as any,
        { page: 1, limit: 20 },
        ownerUser,
      );
      expect(result.items).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.items[0].assigned_doctor.user.first_name).toBe('Ahmed');
      expect(result.items[0].episode.journey.patient.full_name).toBe(
        'Fatima Hassan',
      );
    });

    it('returns paginated visits for DOCTOR in branch', async () => {
      db.branch.findFirst.mockResolvedValue(mockBranch);
      db.$transaction.mockResolvedValue([[mockVisitRow], 1]);
      const result = await service.findAllForBranch(
        'branch-uuid',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'SCHEDULED' as any,
        {},
        doctorUser,
      );
      expect(result.items).toHaveLength(1);
    });

    it('throws ForbiddenException when caller is not in branch and not OWNER', async () => {
      db.branch.findFirst.mockResolvedValue(mockBranch);
      await expect(
        service.findAllForBranch(
          'branch-uuid',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'SCHEDULED' as any,
          {},
          outsiderUser,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when branch does not belong to org', async () => {
      db.branch.findFirst.mockResolvedValue(null);
      await expect(
        service.findAllForBranch(
          'branch-uuid',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'SCHEDULED' as any,
          {},
          ownerUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
