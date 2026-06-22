import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { SurgicalActivationService } from './surgical-activation.service';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.service';
import { EventBus } from '@infrastructure/messaging/event-bus';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { CLINICAL_EVENTS } from '@core/clinical/events/clinical-events';
import { SurgicalEpisodeRouterService } from './surgical-episode-router.service';

const user: AuthContext = {
  userId: 'u1',
  profileId: 'profile-A',
  organizationId: 'org-A',
  role: 'OWNER',
  jobFunction: 'OBGYN',
  branchIds: ['b1'],
};

const VISIT = 'visit-1';

describe('SurgicalActivationService', () => {
  let service: SurgicalActivationService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let access: { assertVisitInOrg: jest.Mock };
  let eventBus: { publish: jest.Mock };
  let episodeRouter: {
    resolveEpisodeOrder: jest.Mock;
    routeVisitToEpisode: jest.Mock;
  };

  beforeEach(async () => {
    db = {
      visit: { findFirst: jest.fn() },
      surgicalJourneyRecord: { findFirst: jest.fn() },
      pregnancyJourneyRecord: { findFirst: jest.fn() },
      carePath: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    access = { assertVisitInOrg: jest.fn().mockResolvedValue(undefined) };
    eventBus = { publish: jest.fn() };
    episodeRouter = {
      resolveEpisodeOrder: jest.fn().mockReturnValue(null),
      routeVisitToEpisode: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SurgicalActivationService,
        { provide: PrismaService, useValue: { db } },
        { provide: PatientAccessService, useValue: access },
        { provide: EventBus, useValue: eventBus },
        { provide: SurgicalEpisodeRouterService, useValue: episodeRouter },
      ],
    }).compile();

    service = module.get(SurgicalActivationService);
  });

  function liveJourney(carePathCode: string | null) {
    db.visit.findFirst.mockResolvedValue({
      specialty_code: 'OBGYN',
      scheduled_at: new Date('2026-06-10T00:00:00.000Z'),
      episode: {
        id: 'episode-0',
        journey: {
          id: 'journey-1',
          patient_id: 'patient-1',
          organization_id: 'org-A',
          status: 'ACTIVE',
          care_path: carePathCode ? { code: carePathCode } : null,
        },
      },
    });
  }

  function txObject(overrides: Record<string, unknown> = {}) {
    return {
      journeyTemplate: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'jt-surg',
          episodes: [
            { id: 'et-1', name: 'Pre-operative', order: 1 },
            { id: 'et-2', name: 'Surgery', order: 2 },
            { id: 'et-3', name: 'Post-operative', order: 3 },
          ],
        }),
      },
      patientJourney: {
        create: jest.fn().mockResolvedValue({ id: 'journey-SURG' }),
        update: jest.fn(),
      },
      patientEpisode: { createMany: jest.fn() },
      visit: { update: jest.fn() },
      pregnancyJourneyRecordRevision: { create: jest.fn() },
      pregnancyJourneyRecord: { update: jest.fn() },
      surgicalJourneyRecord: {
        create: jest.fn().mockResolvedValue({
          journey_id: 'journey-SURG',
          status: 'ACTIVE',
          created_at: new Date('2026-06-10T00:00:00.000Z'),
          procedure_code: 'CESAREAN_SECTION',
          procedure_name: 'Cesarean section',
        }),
      },
      ...overrides,
    };
  }

  describe('activate', () => {
    it('is idempotent — returns the existing profile without re-creating or emitting', async () => {
      liveJourney('OBGYN_SURGICAL');
      db.surgicalJourneyRecord.findFirst.mockResolvedValue({
        journey_id: 'journey-1',
        status: 'ACTIVE',
        created_at: new Date('2026-06-01T00:00:00.000Z'),
      });

      const result = await service.activate(VISIT, {}, user);

      expect(result.journey_id).toBe('journey-1');
      expect(db.carePath.findFirst).not.toHaveBeenCalled();
      expect(db.$transaction).not.toHaveBeenCalled();
      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('blocks with 409 PREGNANCY_ACTIVE_REQUIRES_CLOSE when a pregnancy is active and no outcome is supplied', async () => {
      liveJourney('OBGYN_PREGNANCY');
      db.surgicalJourneyRecord.findFirst.mockResolvedValue(null);
      db.carePath.findFirst.mockResolvedValue({
        id: 'cp-surg',
        journey_template_id: 'jt-surg',
      });
      db.pregnancyJourneyRecord.findFirst.mockResolvedValue({
        id: 'pjr-1',
        version: 2,
      });

      try {
        await service.activate(VISIT, {}, user);
        fail('expected a ConflictException');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const response = (err as ConflictException).getResponse() as {
          code: string;
        };
        expect(response.code).toBe('PREGNANCY_ACTIVE_REQUIRES_CLOSE');
      }
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('cesarean handoff: closes the active pregnancy, opens a cross-linked surgical journey, emits both events', async () => {
      liveJourney('OBGYN_PREGNANCY');
      db.surgicalJourneyRecord.findFirst.mockResolvedValue(null);
      db.carePath.findFirst.mockResolvedValue({
        id: 'cp-surg',
        journey_template_id: 'jt-surg',
      });
      db.pregnancyJourneyRecord.findFirst.mockResolvedValue({
        id: 'pjr-1',
        version: 2,
      });
      const tx = txObject();
      db.$transaction.mockImplementation((cb: (t: typeof tx) => unknown) =>
        cb(tx),
      );

      const result = await service.activate(
        VISIT,
        {
          procedure_code: 'CESAREAN_SECTION',
          pregnancy_outcome: {
            outcome_type: 'LIVE_BIRTH',
            delivery_mode: 'CESAREAN',
          },
        },
        user,
      );

      // The active pregnancy is closed in-transaction.
      expect(tx.pregnancyJourneyRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pjr-1' },
          data: expect.objectContaining({ status: 'CLOSED' }),
        }),
      );
      // The new surgical record cross-links the closed pregnancy journey.
      expect(tx.surgicalJourneyRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            journey_id: 'journey-SURG',
            source_pregnancy_journey_id: 'journey-1',
          }),
        }),
      );
      expect(eventBus.publish).toHaveBeenCalledWith(
        CLINICAL_EVENTS.pregnancy.closed,
        expect.objectContaining({ journey_id: 'journey-1' }),
      );
      expect(eventBus.publish).toHaveBeenCalledWith(
        CLINICAL_EVENTS.surgical.booked,
        expect.objectContaining({
          journey_id: 'journey-SURG',
          source_pregnancy_journey_id: 'journey-1',
        }),
      );
      expect(result.status).toBe('ACTIVE');
    });

    it('general surgery (no pregnancy): opens a surgical journey with no source link', async () => {
      liveJourney('OBGYN_GENERAL');
      db.surgicalJourneyRecord.findFirst.mockResolvedValue(null);
      db.carePath.findFirst.mockResolvedValue({
        id: 'cp-surg',
        journey_template_id: 'jt-surg',
      });
      db.pregnancyJourneyRecord.findFirst.mockResolvedValue(null);
      const tx = txObject();
      db.$transaction.mockImplementation((cb: (t: typeof tx) => unknown) =>
        cb(tx),
      );

      await service.activate(VISIT, { procedure_code: 'MYOMECTOMY' }, user);

      expect(tx.pregnancyJourneyRecord.update).not.toHaveBeenCalled();
      expect(tx.surgicalJourneyRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            source_pregnancy_journey_id: null,
          }),
        }),
      );
      // Routed to Pre-op (no surgery date → default order 1).
      expect(episodeRouter.routeVisitToEpisode).toHaveBeenCalledWith(
        tx,
        'journey-SURG',
        VISIT,
        1,
      );
      expect(eventBus.publish).toHaveBeenCalledWith(
        CLINICAL_EVENTS.surgical.booked,
        expect.objectContaining({ journey_id: 'journey-SURG' }),
      );
    });
  });

  describe('close', () => {
    it('completes the journey, closes the profile, and emits surgical.closed', async () => {
      db.visit.findFirst.mockResolvedValue({
        assigned_doctor_id: 'profile-A',
        episode: { journey: { id: 'journey-1', patient_id: 'patient-1' } },
      });
      db.surgicalJourneyRecord.findFirst.mockResolvedValue({
        id: 'sjr-1',
        version: 3,
      });

      const tx = {
        surgicalJourneyRecordRevision: { create: jest.fn() },
        surgicalJourneyRecord: {
          update: jest.fn().mockResolvedValue({
            journey_id: 'journey-1',
            status: 'CLOSED',
            created_at: new Date('2026-06-01T00:00:00.000Z'),
          }),
        },
        patientJourney: { update: jest.fn() },
      };
      db.$transaction.mockImplementation((cb: (t: typeof tx) => unknown) =>
        cb(tx),
      );

      const result = await service.close(
        VISIT,
        { outcome: { outcome_type: 'COMPLETED', notes: 'uncomplicated' } },
        user,
      );

      expect(tx.patientJourney.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'journey-1' },
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
      expect(eventBus.publish).toHaveBeenCalledWith(
        CLINICAL_EVENTS.surgical.closed,
        expect.objectContaining({
          journey_id: 'journey-1',
          outcome_type: 'COMPLETED',
        }),
      );
      expect(result.status).toBe('CLOSED');
    });
  });
});
