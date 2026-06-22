import { Test, TestingModule } from '@nestjs/testing';
import { PregnancyActivationService } from './pregnancy-activation.service';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.service';
import { EventBus } from '@infrastructure/messaging/event-bus';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { CLINICAL_EVENTS } from '@core/clinical/events/clinical-events';

const user: AuthContext = {
  userId: 'u1',
  profileId: 'profile-A',
  organizationId: 'org-A',
  role: 'OWNER',
  jobFunction: 'OBGYN',
  branchIds: ['b1'],
};

const VISIT = 'visit-1';

describe('PregnancyActivationService', () => {
  let service: PregnancyActivationService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let access: { assertVisitInOrg: jest.Mock };
  let eventBus: { publish: jest.Mock };

  beforeEach(async () => {
    db = {
      visit: { findFirst: jest.fn() },
      pregnancyJourneyRecord: { findFirst: jest.fn() },
      carePath: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    access = { assertVisitInOrg: jest.fn().mockResolvedValue(undefined) };
    eventBus = { publish: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PregnancyActivationService,
        { provide: PrismaService, useValue: { db } },
        { provide: PatientAccessService, useValue: access },
        { provide: EventBus, useValue: eventBus },
      ],
    }).compile();

    service = module.get(PregnancyActivationService);
  });

  describe('activate', () => {
    function liveJourney(carePathCode: string | null) {
      db.visit.findFirst.mockResolvedValue({
        specialty_code: 'OBGYN',
        episode: {
          journey: {
            id: 'journey-1',
            patient_id: 'patient-1',
            status: 'ACTIVE',
            care_path: carePathCode ? { code: carePathCode } : null,
          },
        },
      });
    }

    it('is idempotent — returns the existing profile without re-creating or emitting', async () => {
      liveJourney('OBGYN_PREGNANCY');
      db.pregnancyJourneyRecord.findFirst.mockResolvedValue({
        journey_id: 'journey-1',
        status: 'ACTIVE',
        created_at: new Date('2026-02-01T00:00:00.000Z'),
      });

      const result = await service.activate(VISIT, {}, user);

      expect(result.journey_id).toBe('journey-1');
      expect(db.carePath.findFirst).not.toHaveBeenCalled();
      expect(db.$transaction).not.toHaveBeenCalled();
      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('sets the care path, creates an ACTIVE profile, and emits care-path + booked events', async () => {
      liveJourney('OBGYN_GENERAL');
      db.pregnancyJourneyRecord.findFirst.mockResolvedValue(null);
      db.carePath.findFirst.mockResolvedValue({ id: 'cp-preg' });

      const tx = {
        patientJourney: { update: jest.fn() },
        pregnancyJourneyRecord: {
          create: jest.fn().mockResolvedValue({
            journey_id: 'journey-1',
            status: 'ACTIVE',
            created_at: new Date('2026-02-01T00:00:00.000Z'),
            lmp: null,
          }),
        },
      };
      db.$transaction.mockImplementation((cb: (t: typeof tx) => unknown) =>
        cb(tx),
      );

      const result = await service.activate(
        VISIT,
        { risk_level: 'NORMAL' },
        user,
      );

      expect(tx.patientJourney.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'journey-1' },
          data: { care_path_id: 'cp-preg' },
        }),
      );
      expect(tx.pregnancyJourneyRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            journey_id: 'journey-1',
            status: 'ACTIVE',
          }),
        }),
      );
      expect(eventBus.publish).toHaveBeenCalledWith(
        CLINICAL_EVENTS.journey.carePathSet,
        expect.objectContaining({
          previous_care_path_code: 'OBGYN_GENERAL',
          new_care_path_code: 'OBGYN_PREGNANCY',
        }),
      );
      expect(eventBus.publish).toHaveBeenCalledWith(
        CLINICAL_EVENTS.pregnancy.booked,
        expect.objectContaining({ journey_id: 'journey-1' }),
      );
      expect(result.status).toBe('ACTIVE');
    });
  });

  describe('close', () => {
    it('completes the journey, closes the profile, and emits pregnancy.closed', async () => {
      db.visit.findFirst.mockResolvedValue({
        assigned_doctor_id: 'profile-A',
        episode: { journey: { id: 'journey-1', patient_id: 'patient-1' } },
      });
      db.pregnancyJourneyRecord.findFirst.mockResolvedValue({
        id: 'pjr-1',
        version: 4,
      });

      const tx = {
        pregnancyJourneyRecordRevision: { create: jest.fn() },
        pregnancyJourneyRecord: {
          update: jest.fn().mockResolvedValue({
            journey_id: 'journey-1',
            status: 'CLOSED',
            created_at: new Date('2026-02-01T00:00:00.000Z'),
          }),
        },
        patientJourney: { update: jest.fn() },
      };
      db.$transaction.mockImplementation((cb: (t: typeof tx) => unknown) =>
        cb(tx),
      );

      const result = await service.close(
        VISIT,
        {
          outcome: {
            outcome_type: 'LIVE_BIRTH',
            delivery_mode: 'CESAREAN',
            notes: 'twins',
          },
        },
        user,
      );

      expect(tx.patientJourney.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'journey-1' },
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
      expect(eventBus.publish).toHaveBeenCalledWith(
        CLINICAL_EVENTS.pregnancy.closed,
        expect.objectContaining({
          journey_id: 'journey-1',
          outcome_type: 'LIVE_BIRTH',
          outcome: expect.objectContaining({ delivery_mode: 'CESAREAN' }),
        }),
      );
      expect(result.status).toBe('CLOSED');
    });
  });
});
