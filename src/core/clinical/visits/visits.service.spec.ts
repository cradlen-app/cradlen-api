import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { VisitsService } from './visits.service';
import { EventBus } from '@infrastructure/messaging/event-bus';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { TemplateValidator } from '@builder/validator/template.validator';
import { TemplatesService } from '@builder/templates/templates.service';
import { AuthorizationService } from '@core/auth/authorization/authorization.service';
import { ChargingService } from '@core/financial/charging/charging.service';

const mockUser: AuthContext = {
  userId: 'user-uuid',
  profileId: 'profile-uuid',
  organizationId: 'org-uuid',
  activeBranchId: 'branch-uuid',
  roles: ['RECEPTIONIST'],
  jobFunctions: ['RECEPTIONIST'],
  branchIds: ['branch-uuid'],
};

// The doctor the mock visit was booked for (assigned_doctor_id: 'doctor-uuid').
// Only this actor (or an owner/manager) may start/complete the visit.
const mockDoctorUser: AuthContext = {
  userId: 'user-doctor',
  profileId: 'doctor-uuid',
  organizationId: 'org-uuid',
  activeBranchId: 'branch-uuid',
  roles: ['STAFF'],
  jobFunctions: ['OTHER_DOCTOR'],
  branchIds: ['branch-uuid'],
};

const mockEpisodeWithJourney = {
  id: 'ep-uuid',
  journey_id: 'journey-uuid',
  is_deleted: false,
  journey: { organization_id: 'org-uuid', patient_id: 'patient-uuid' },
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

const mockCarePath = {
  id: 'care-path-uuid',
  journey_template: mockTemplate,
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
  let chargingServiceMock: { capture: jest.Mock };
  let db: {
    patientEpisode: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      createMany: jest.Mock;
    };
    patient: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    patientJourney: { findFirst: jest.Mock; create: jest.Mock };
    guardian: { findFirst: jest.Mock; upsert: jest.Mock; create: jest.Mock };
    patientGuardian: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    carePath: { findFirst: jest.Mock };
    visit: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
    branch: { findFirst: jest.Mock };
    profileBranch: { findFirst: jest.Mock };
    providerService: { findFirst: jest.Mock };
    visitEncounter: { findUnique: jest.Mock; upsert: jest.Mock };
    visitVitals: { upsert: jest.Mock };
    patientOrgEnrollment: {
      findFirst: jest.Mock;
      create: jest.Mock;
      createMany: jest.Mock;
      updateMany: jest.Mock;
    };
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
      patient: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      patientJourney: { findFirst: jest.fn(), create: jest.fn() },
      guardian: { findFirst: jest.fn(), upsert: jest.fn(), create: jest.fn() },
      patientGuardian: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      carePath: { findFirst: jest.fn() },
      visit: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
      },
      branch: { findFirst: jest.fn() },
      profileBranch: { findFirst: jest.fn().mockResolvedValue({ id: 'pb-1' }) },
      providerService: {
        findFirst: jest.fn().mockResolvedValue({ id: 'ps-1' }),
      },
      visitEncounter: { findUnique: jest.fn(), upsert: jest.fn() },
      visitVitals: { upsert: jest.fn() },
      patientOrgEnrollment: {
        findFirst: jest.fn(),
        create: jest.fn(),
        createMany: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    prismaMock = { db };
    eventBusMock = { publish: jest.fn() };
    const templateValidatorMock = {
      validatePayload: jest.fn().mockResolvedValue({ ok: true }),
    };
    const templatesServiceMock = {
      findActiveByCode: jest.fn().mockResolvedValue({ id: 'tpl-uuid' }),
    };
    const authorizationServiceMock = {
      assertCanAccessBranch: jest.fn().mockResolvedValue(undefined),
    };
    chargingServiceMock = {
      capture: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisitsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EventBus, useValue: eventBusMock },
        { provide: TemplateValidator, useValue: templateValidatorMock },
        { provide: TemplatesService, useValue: templatesServiceMock },
        { provide: AuthorizationService, useValue: authorizationServiceMock },
        { provide: ChargingService, useValue: chargingServiceMock },
      ],
    }).compile();
    service = module.get<VisitsService>(VisitsService);
  });

  describe('findMyWaitingList', () => {
    it('scopes to the branch AND the current doctor', async () => {
      db.$transaction.mockResolvedValue([[], 0]);
      await service.findMyWaitingList('branch-uuid', {}, mockUser);
      expect(db.visit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            assigned_doctor_id: mockUser.profileId,
            branch_id: 'branch-uuid',
            status: { in: ['SCHEDULED', 'CHECKED_IN'] },
          }),
        }),
      );
    });
  });

  describe('findMyCurrent', () => {
    it('scopes to the branch AND the current doctor', async () => {
      db.visit.findMany.mockResolvedValue([]);
      await service.findMyCurrent('branch-uuid', mockUser);
      expect(db.visit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            assigned_doctor_id: mockUser.profileId,
            branch_id: 'branch-uuid',
            status: 'IN_PROGRESS',
          }),
        }),
      );
    });

    it('returns every in-progress visit, not just one', async () => {
      db.visit.findMany.mockResolvedValue([{ id: 'v1' }, { id: 'v2' }]);
      const result = await service.findMyCurrent('branch-uuid', mockUser);
      expect(result.data).toHaveLength(2);
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

    it('sets checked_in_at when transitioning to CHECKED_IN (queue_number is assigned at booking, not checkin)', async () => {
      db.visit.findUnique.mockResolvedValue({
        ...mockVisit,
        status: 'SCHEDULED',
        queue_number: 1,
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
          }),
        }),
      );
      // queue_number is preserved from booking, not set by updateStatus.
      const updateCall = db.visit.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(updateCall.data.queue_number).toBeUndefined();
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
        mockDoctorUser,
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
          mockDoctorUser,
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
          mockDoctorUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects COMPLETED transition when provisional_diagnosis is empty', async () => {
      db.visit.findUnique.mockResolvedValue({
        ...mockVisit,
        status: 'IN_PROGRESS',
      });
      db.visitEncounter.findUnique.mockResolvedValue({
        chief_complaint: 'Bleeding',
        provisional_diagnosis: null,
      });
      await expect(
        service.updateStatus(
          'visit-uuid',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { status: 'COMPLETED' as any },
          mockDoctorUser,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(db.visit.update).not.toHaveBeenCalled();
    });

    it('sets completed_at when transitioning to COMPLETED', async () => {
      db.visit.findUnique.mockResolvedValue({
        ...mockVisit,
        status: 'IN_PROGRESS',
      });
      db.visitEncounter.findUnique.mockResolvedValue({
        chief_complaint: 'Bleeding',
        provisional_diagnosis: 'Hypertension',
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
        mockDoctorUser,
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

    describe('updateStatus CHECKED_IN enrollment activation', () => {
      const visitWithJourney = {
        ...mockVisit,
        status: 'SCHEDULED' as const,
        episode: {
          id: 'ep-uuid',
          journey: {
            organization_id: 'org-uuid',
            patient: { id: 'patient-uuid', full_name: 'Jane Doe' },
            care_path: null,
          },
        },
      };

      it('activates a PENDING enrollment inside the transaction when visit moves to CHECKED_IN', async () => {
        db.visit.findUnique.mockResolvedValue(visitWithJourney);
        db.patientEpisode.findUnique.mockResolvedValue({
          journey_id: 'journey-uuid',
        });
        const tx = {
          visit: {
            update: jest
              .fn()
              .mockResolvedValue({ ...visitWithJourney, status: 'CHECKED_IN' }),
            count: jest.fn().mockResolvedValue(0),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          patientOrgEnrollment: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        };
        db.$transaction.mockImplementation(
          async (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
        );

        await service.updateStatus(
          'visit-uuid',
          { status: 'CHECKED_IN' },
          mockUser,
        );

        expect(tx.patientOrgEnrollment.updateMany).toHaveBeenCalledWith({
          where: {
            patient_id: 'patient-uuid',
            organization_id: 'org-uuid',
            status: 'PENDING',
            is_deleted: false,
          },
          data: expect.objectContaining({
            status: 'ACTIVE',
            activated_at: expect.any(Date),
          }),
        });
        // Verify it did NOT run on the outer db client
        expect(db.patientOrgEnrollment.updateMany).not.toHaveBeenCalled();
      });

      it('does not call enrollment updateMany for non-CHECKED_IN transitions', async () => {
        const checkedInVisit = {
          ...visitWithJourney,
          status: 'CHECKED_IN' as const,
        };
        db.visit.findUnique.mockResolvedValue(checkedInVisit);
        db.patientEpisode.findUnique.mockResolvedValue({
          journey_id: 'journey-uuid',
        });
        const tx = {
          visit: {
            update: jest
              .fn()
              .mockResolvedValue({ ...checkedInVisit, status: 'IN_PROGRESS' }),
            count: jest.fn().mockResolvedValue(0),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          patientOrgEnrollment: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
        };
        db.$transaction.mockImplementation(
          async (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
        );

        await service.updateStatus(
          'visit-uuid',
          { status: 'IN_PROGRESS' },
          mockDoctorUser,
        );

        expect(tx.patientOrgEnrollment.updateMany).not.toHaveBeenCalled();
        expect(db.patientOrgEnrollment.updateMany).not.toHaveBeenCalled();
      });
    });
  });

  describe('visit lifecycle actor guards', () => {
    const ownerUser: AuthContext = {
      userId: 'user-owner',
      profileId: 'owner-uuid',
      organizationId: 'org-uuid',
      activeBranchId: 'branch-uuid',
      roles: ['OWNER'],
      jobFunctions: [],
      branchIds: ['branch-uuid'],
    };

    // A clinician who is NOT the doctor this visit was booked for.
    const otherDoctorUser: AuthContext = {
      userId: 'user-other-doc',
      profileId: 'other-doctor-uuid',
      organizationId: 'org-uuid',
      activeBranchId: 'branch-uuid',
      roles: ['STAFF'],
      jobFunctions: ['OTHER_DOCTOR'],
      branchIds: ['branch-uuid'],
    };

    it('bookVisit rejects a non-reception, non-privileged actor before any work', async () => {
      await expect(
        service.bookVisit({} as never, mockDoctorUser),
      ).rejects.toThrow(ForbiddenException);
      // Guard short-circuits before template validation / any DB access.
      expect(db.visit.create).not.toHaveBeenCalled();
    });

    it('updateStatus to IN_PROGRESS is forbidden for a receptionist (not the assigned doctor)', async () => {
      db.visit.findUnique.mockResolvedValue({
        ...mockVisit,
        status: 'CHECKED_IN',
      });
      await expect(
        service.updateStatus('visit-uuid', { status: 'IN_PROGRESS' }, mockUser),
      ).rejects.toThrow(ForbiddenException);
      expect(db.visit.update).not.toHaveBeenCalled();
    });

    it('updateStatus to IN_PROGRESS is forbidden for a different doctor', async () => {
      db.visit.findUnique.mockResolvedValue({
        ...mockVisit,
        status: 'CHECKED_IN',
      });
      await expect(
        service.updateStatus(
          'visit-uuid',
          { status: 'IN_PROGRESS' },
          otherDoctorUser,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('updateStatus to COMPLETED is forbidden for a receptionist', async () => {
      db.visit.findUnique.mockResolvedValue({
        ...mockVisit,
        status: 'IN_PROGRESS',
      });
      await expect(
        service.updateStatus('visit-uuid', { status: 'COMPLETED' }, mockUser),
      ).rejects.toThrow(ForbiddenException);
      // Guard runs before the encounter/diagnosis completion checks.
      expect(db.visitEncounter.findUnique).not.toHaveBeenCalled();
    });

    it('updateStatus to IN_PROGRESS is allowed for an owner override', async () => {
      db.visit.findUnique.mockResolvedValue({
        ...mockVisit,
        status: 'CHECKED_IN',
      });
      db.visit.update.mockResolvedValue({
        ...mockVisit,
        status: 'IN_PROGRESS',
        started_at: new Date(),
      });
      db.$transaction.mockImplementation(
        async (cb: (tx: typeof db) => Promise<unknown>) => cb(db),
      );

      await expect(
        service.updateStatus(
          'visit-uuid',
          { status: 'IN_PROGRESS' },
          ownerUser,
        ),
      ).resolves.toBeDefined();
    });

    it('updateStatus to CHECKED_IN is forbidden for a doctor (reception-only action)', async () => {
      db.visit.findUnique.mockResolvedValue({
        ...mockVisit,
        status: 'SCHEDULED',
      });
      await expect(
        service.updateStatus(
          'visit-uuid',
          { status: 'CHECKED_IN' },
          mockDoctorUser,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('a COMPLETED visit cannot be reopened to IN_PROGRESS (terminal transition)', async () => {
      db.visit.findUnique.mockResolvedValue({
        ...mockVisit,
        status: 'COMPLETED',
      });
      await expect(
        service.updateStatus(
          'visit-uuid',
          { status: 'IN_PROGRESS' },
          mockDoctorUser,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(db.visit.update).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus cascade enrollment cleanup', () => {
    const scheduledVisit = {
      ...mockVisit,
      status: 'SCHEDULED' as const,
      episode: {
        id: 'ep-uuid',
        journey: {
          organization_id: 'org-uuid',
          patient: { id: 'patient-uuid', full_name: 'Jane Doe' },
          care_path: null,
        },
      },
    };

    it('soft-deletes PENDING enrollment when cascade fires and no other journeys remain', async () => {
      db.visit.findUnique.mockResolvedValue(scheduledVisit);
      db.patientEpisode.findUnique.mockResolvedValue({
        journey_id: 'journey-uuid',
      });
      const tx = {
        visit: {
          update: jest
            .fn()
            .mockResolvedValue({ ...scheduledVisit, status: 'CANCELLED' }),
          count: jest
            .fn()
            .mockResolvedValueOnce(0) // realCount
            .mockResolvedValueOnce(0), // liveCount
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        visitEncounter: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        visitVitals: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        patientEpisode: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        patientJourney: { update: jest.fn().mockResolvedValue({}) },
        patientOrgEnrollment: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        $executeRaw: jest.fn().mockResolvedValue(1),
      };
      db.$transaction.mockImplementation(
        async (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
      );

      await service.updateStatus(
        'visit-uuid',
        { status: 'CANCELLED' },
        mockUser,
      );

      expect(tx.patientOrgEnrollment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            patient_id: 'patient-uuid',
            organization_id: 'org-uuid',
            status: 'PENDING',
            is_deleted: false,
          }),
          data: expect.objectContaining({ is_deleted: true }),
        }),
      );
      expect(tx.$executeRaw).toHaveBeenCalled();
    });

    it('does not soft-delete patient when other journeys exist', async () => {
      db.visit.findUnique.mockResolvedValue(scheduledVisit);
      db.patientEpisode.findUnique.mockResolvedValue({
        journey_id: 'journey-uuid',
      });
      const tx = {
        visit: {
          update: jest
            .fn()
            .mockResolvedValue({ ...scheduledVisit, status: 'CANCELLED' }),
          count: jest
            .fn()
            .mockResolvedValueOnce(0) // realCount
            .mockResolvedValueOnce(0), // liveCount
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        visitEncounter: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        visitVitals: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        patientEpisode: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        patientJourney: { update: jest.fn().mockResolvedValue({}) },
        patientOrgEnrollment: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        $executeRaw: jest.fn().mockResolvedValue(0), // NOT EXISTS returns false → no row updated
      };
      db.$transaction.mockImplementation(
        async (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
      );

      await service.updateStatus(
        'visit-uuid',
        { status: 'CANCELLED' },
        mockUser,
      );

      expect(tx.patientOrgEnrollment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            patient_id: 'patient-uuid',
            organization_id: 'org-uuid',
            status: 'PENDING',
            is_deleted: false,
          }),
        }),
      );
      expect(tx.$executeRaw).toHaveBeenCalled();
    });

    it('does not clean up enrollment when checked-in visits still exist (cascade not entered)', async () => {
      db.visit.findUnique.mockResolvedValue(scheduledVisit);
      db.patientEpisode.findUnique.mockResolvedValue({
        journey_id: 'journey-uuid',
      });
      const tx = {
        visit: {
          update: jest
            .fn()
            .mockResolvedValue({ ...scheduledVisit, status: 'CANCELLED' }),
          count: jest
            .fn()
            .mockResolvedValueOnce(1) // realCount > 0 — cascade not entered
            .mockResolvedValueOnce(0), // liveCount (not reached)
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        visitEncounter: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        visitVitals: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        patientEpisode: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        patientJourney: { update: jest.fn().mockResolvedValue({}) },
        patientOrgEnrollment: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        $executeRaw: jest.fn().mockResolvedValue(0),
      };
      db.$transaction.mockImplementation(
        async (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
      );

      await service.updateStatus(
        'visit-uuid',
        { status: 'CANCELLED' },
        mockUser,
      );

      expect(tx.patientOrgEnrollment.updateMany).not.toHaveBeenCalled();
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('bookVisit', () => {
    const baseDto = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      visitor_type: 'PATIENT' as any,
      specialty_code: 'OBGYN',
      national_id: '12345',
      full_name: 'Jane Doe',
      date_of_birth: '1990-01-01',
      phone_number: '0500000000',
      address: '123 Main St',
      assigned_doctor_id: 'doctor-uuid',
      service_id: 'service-uuid',
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
      // assertDoctorSpecialty short-circuits to "ok" — tests that need to
      // exercise its failure path override this in their own setup.
      db.profile = {
        findFirst: jest.fn().mockResolvedValue({ id: 'doctor-uuid' }),
      };
      // enrollment is created in-transaction via createMany + skipDuplicates.
      db.patientOrgEnrollment.createMany.mockResolvedValue({ count: 1 });
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

    it('throws BadRequestException when branch_id absent and user has no activeBranchId', async () => {
      db.carePath.findFirst.mockResolvedValue(mockCarePath);
      const userNoBranch = { ...mockUser, activeBranchId: undefined };
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        service.bookVisit(baseDto, userNoBranch as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when GENERAL_GYN template not found', async () => {
      db.carePath.findFirst.mockResolvedValue(null);
      await expect(service.bookVisit(baseDto, mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when patient_id provided but patient not found', async () => {
      db.carePath.findFirst.mockResolvedValue(mockCarePath);
      db.patient.findUnique.mockResolvedValue(null);
      await expect(
        service.bookVisit(
          { ...baseDto, patient_id: 'nonexistent-uuid' },
          mockUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when new patient has duplicate national_id', async () => {
      db.carePath.findFirst.mockResolvedValue(mockCarePath);
      db.patient.findUnique.mockResolvedValue({
        ...mockPatient,
        is_deleted: false,
      });
      await expect(service.bookVisit(baseDto, mockUser)).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates new patient, journey, episodes and visit on first walk-in', async () => {
      db.carePath.findFirst.mockResolvedValue(mockCarePath);
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
      db.carePath.findFirst.mockResolvedValue(mockCarePath);
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

    it('rejects with PATIENT_HAS_OPEN_VISIT when patient already has an open visit that day', async () => {
      db.carePath.findFirst.mockResolvedValue(mockCarePath);
      db.patient.findUnique.mockResolvedValue(mockPatient);
      db.visit.findFirst.mockResolvedValue({ id: 'existing-open-visit' });

      const err = await service
        .bookVisit({ ...baseDto, patient_id: 'patient-uuid' }, mockUser)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect(
        (err as ConflictException).getResponse() as { code: string },
      ).toMatchObject({ code: 'PATIENT_HAS_OPEN_VISIT' });
      expect(db.visit.create).not.toHaveBeenCalled();
    });

    it('scopes the duplicate check to open statuses in the branch on the booking day', async () => {
      db.carePath.findFirst.mockResolvedValue(mockCarePath);
      db.patient.findUnique.mockResolvedValue(null);
      db.patient.create.mockResolvedValue(mockPatient);
      db.patientJourney.findFirst.mockResolvedValue(mockJourney);
      db.patientEpisode.findFirst.mockResolvedValue(mockEpisode);
      db.visit.findFirst.mockResolvedValue(null);
      db.visit.create.mockResolvedValue({
        ...mockVisit,
        episode_id: 'gen-ep-uuid',
      });

      await service.bookVisit(baseDto, mockUser);

      expect(db.visit.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            branch_id: 'branch-uuid',
            is_deleted: false,
            status: { in: ['SCHEDULED', 'CHECKED_IN', 'IN_PROGRESS'] },
            scheduled_at: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
            episode: { journey: { patient_id: 'patient-uuid' } },
          }),
        }),
      );
    });

    it('emits visit.booked WebSocket event after successful booking', async () => {
      db.carePath.findFirst.mockResolvedValue(mockCarePath);
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

    it('rejects when the assigned doctor is not authorized for the service', async () => {
      db.carePath.findFirst.mockResolvedValue(mockCarePath);
      db.providerService.findFirst.mockResolvedValue(null);

      await expect(service.bookVisit(baseDto, mockUser)).rejects.toThrow(
        BadRequestException,
      );
      expect(db.visit.create).not.toHaveBeenCalled();
    });

    it('captures a PENDING charge for the booked service', async () => {
      db.carePath.findFirst.mockResolvedValue(mockCarePath);
      db.patient.findUnique.mockResolvedValue(null);
      db.patient.create.mockResolvedValue(mockPatient);
      db.patientJourney.findFirst.mockResolvedValue(null);
      db.patientJourney.create.mockResolvedValue(mockJourney);
      db.patientEpisode.createMany.mockResolvedValue({ count: 1 });
      db.patientEpisode.findFirst.mockResolvedValue(mockEpisode);
      db.visit.create.mockResolvedValue({
        ...mockVisit,
        id: 'visit-uuid',
        episode_id: 'gen-ep-uuid',
      });

      await service.bookVisit(baseDto, mockUser);

      expect(chargingServiceMock.capture).toHaveBeenCalledWith(
        mockUser.organizationId,
        expect.objectContaining({
          branch_id: 'branch-uuid',
          patient_id: mockPatient.id,
          profile_id: 'doctor-uuid',
          visit_id: 'visit-uuid',
          service_id: 'service-uuid',
          quantity: 1,
        }),
        mockUser,
      );
    });
  });

  describe('bookVisit enrollment', () => {
    const bookDto = {
      patient_id: 'patient-uuid',
      assigned_doctor_id: 'doctor-uuid',
      service_id: 'service-uuid',
      branch_id: 'branch-uuid',
      specialty_code: 'OBGYN',
      appointment_type: 'VISIT' as const,
      priority: 'NORMAL' as const,
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
    };

    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).profile = {
        findFirst: jest.fn().mockResolvedValue({ id: 'doctor-uuid' }),
      };
      db.branch.findFirst.mockResolvedValue({
        id: 'branch-uuid',
        organization_id: 'org-uuid',
      });
      db.profileBranch.findFirst.mockResolvedValue({ id: 'pb-1' });
      db.carePath.findFirst.mockResolvedValue({
        ...mockCarePath,
        journey_template: {
          ...mockTemplate,
          episodes: [
            { id: 'ep-template-uuid', name: 'General Consultation', order: 1 },
          ],
        },
      });
      db.patient.findUnique.mockResolvedValue(mockPatient);
      db.patientJourney.findFirst.mockResolvedValue(mockJourney);
      db.patientEpisode.findFirst.mockResolvedValue(mockEpisode);
      db.visit.create.mockResolvedValue(mockVisit);
      db.visit.findMany.mockResolvedValue([]);
      db.$transaction.mockImplementation(
        async (cb: (tx: typeof db) => Promise<unknown>) => {
          const result = await cb(db);
          return result;
        },
      );
    });

    it('creates a PENDING enrollment in-transaction, idempotently', async () => {
      db.patientOrgEnrollment.createMany.mockResolvedValue({ count: 1 });

      await service.bookVisit(bookDto, mockUser);

      // createMany + skipDuplicates compiles to INSERT … ON CONFLICT DO NOTHING,
      // so a concurrent booking that already enrolled the patient is skipped at
      // the DB without aborting this transaction.
      expect(db.patientOrgEnrollment.createMany).toHaveBeenCalledWith({
        data: [
          {
            patient_id: mockPatient.id,
            organization_id: mockUser.organizationId,
            status: 'PENDING',
          },
        ],
        skipDuplicates: true,
      });
    });

    it('rolls the booking back when enrollment insertion errors', async () => {
      const dbError = new Prisma.PrismaClientKnownRequestError(
        'Connection error',
        {
          code: 'P1001',
          clientVersion: '7.0.0',
          meta: {},
        },
      );
      db.patientOrgEnrollment.createMany.mockRejectedValue(dbError);

      await expect(service.bookVisit(bookDto, mockUser)).rejects.toThrow();
    });
  });

  describe('findAllForBranch', () => {
    const ownerUser: AuthContext = {
      userId: 'user-uuid',
      profileId: 'profile-uuid',
      organizationId: 'org-uuid',
      activeBranchId: 'branch-uuid',
      roles: ['OWNER'],
      jobFunctions: [],
      branchIds: ['branch-uuid'],
    };

    const doctorUser: AuthContext = {
      userId: 'user-uuid-2',
      profileId: 'profile-uuid-2',
      organizationId: 'org-uuid',
      activeBranchId: 'branch-uuid',
      roles: ['DOCTOR'],
      jobFunctions: ['OTHER_DOCTOR'],
      branchIds: ['branch-uuid'],
    };

    const outsiderUser: AuthContext = {
      userId: 'user-uuid-3',
      profileId: 'profile-uuid-3',
      organizationId: 'org-uuid',
      activeBranchId: 'other-branch',
      roles: ['DOCTOR'],
      jobFunctions: ['OTHER_DOCTOR'],
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

  describe('findPatientVitalsTrend', () => {
    it('returns chronologically-sorted vitals points mapped from completed visits', async () => {
      const mockVisits = [
        {
          id: 'v1',
          completed_at: new Date('2024-01-15T10:00:00Z'),
          vitals: {
            systolic_bp: 120,
            diastolic_bp: 80,
            weight_kg: new Prisma.Decimal('70.50'),
            bmi: new Prisma.Decimal('24.2'),
          },
        },
        {
          id: 'v2',
          completed_at: new Date('2024-02-20T10:00:00Z'),
          vitals: null,
        },
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.visit.findMany.mockResolvedValue(mockVisits as any);

      const result = await service.findPatientVitalsTrend('patient-1', 'org-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        visit_id: 'v1',
        completed_at: new Date('2024-01-15T10:00:00Z'),
        systolic_bp: 120,
        diastolic_bp: 80,
        weight_kg: 70.5,
        bmi: 24.2,
      });
      expect(result[1]).toMatchObject({
        visit_id: 'v2',
        systolic_bp: null,
        diastolic_bp: null,
        weight_kg: null,
        bmi: null,
      });
    });

    it('passes excludeVisitId as id.not filter', async () => {
      db.visit.findMany.mockResolvedValue([]);

      await service.findPatientVitalsTrend(
        'patient-1',
        'org-1',
        'skip-this-visit',
      );

      expect(db.visit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { not: 'skip-this-visit' },
          }),
        }),
      );
    });
  });

  describe('findPatientVisitHistory', () => {
    it('returns paginated completed visits with clinical summaries, excluding the current visit', async () => {
      const completedAt = new Date('2025-09-30T10:00:00Z');
      const mockHistoryVisit = {
        id: 'history-visit-uuid',
        appointment_type: 'VISIT',
        completed_at: completedAt,
        encounter: { provisional_diagnosis: 'Hypertension' },
        prescription: {
          items: [
            {
              medication: { name: 'Amlodipine' },
              custom_drug_name: null,
              dose: '5 mg',
            },
          ],
        },
        investigations: [{ lab_test: { name: 'CBC' }, custom_test_name: null }],
      };

      db.visit.findMany.mockResolvedValue([mockHistoryVisit]);
      db.visit.count.mockResolvedValue(1);
      db.$transaction.mockImplementation((queries: Promise<unknown>[]) =>
        Promise.all(queries),
      );

      const result = await service.findPatientVisitHistory(
        'patient-uuid',
        'org-uuid',
        { page: 1, limit: 3, excludeVisitId: 'current-visit-uuid' },
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: 'history-visit-uuid',
        appointment_type: 'VISIT',
        completed_at: completedAt,
        diagnosis: 'Hypertension',
        medications: [{ name: 'Amlodipine', dose: '5 mg' }],
        investigations: ['CBC'],
      });
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
      expect(db.visit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'COMPLETED',
            id: { not: 'current-visit-uuid' },
          }),
        }),
      );
    });

    it('falls back to custom_drug_name when medication link is null', async () => {
      const mockVisitNoMed = {
        id: 'v2',
        appointment_type: 'FOLLOW_UP',
        completed_at: new Date(),
        encounter: null,
        prescription: {
          items: [
            {
              medication: null,
              custom_drug_name: 'Paracetamol',
              dose: '500 mg',
            },
          ],
        },
        investigations: [],
      };

      db.visit.findMany.mockResolvedValue([mockVisitNoMed]);
      db.visit.count.mockResolvedValue(1);
      db.$transaction.mockImplementation((queries: Promise<unknown>[]) =>
        Promise.all(queries),
      );

      const result = await service.findPatientVisitHistory(
        'patient-uuid',
        'org-uuid',
        { page: 1, limit: 3 },
      );

      expect(result.items[0].diagnosis).toBeNull();
      expect(result.items[0].medications).toEqual([
        { name: 'Paracetamol', dose: '500 mg' },
      ]);
    });
  });
});
