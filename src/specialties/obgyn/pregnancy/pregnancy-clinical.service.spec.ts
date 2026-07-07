import { Test, TestingModule } from '@nestjs/testing';
import { PregnancyClinicalService } from './pregnancy-clinical.service';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.service';
import { TemplateValidator } from '@builder/validator/template.validator';
import { EventBus } from '@infrastructure/messaging/event-bus';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { CLINICAL_EVENTS } from '@core/clinical/events/clinical-events';
import { ObgynHistoryService } from '../patient-history/obgyn-history.service';
import { JourneyClinicalRegistry } from '../journeys/journey-clinical.registry';
import { PregnancyEpisodeRouterService } from './pregnancy-episode-router.service';

const user: AuthContext = {
  userId: 'u1',
  profileId: 'profile-A',
  organizationId: 'org-A',
  role: 'OWNER',
  jobFunction: 'OBGYN',
  branchIds: ['b1'],
};

const VISIT = 'visit-1';
const JOURNEY = 'journey-1';

function journeyRecord(over: Record<string, unknown> = {}) {
  return {
    id: 'pjr-1',
    journey_id: JOURNEY,
    version: 2,
    status: 'ACTIVE',
    risk_level: 'NORMAL',
    lmp: new Date('2026-01-01T00:00:00.000Z'),
    blood_group_rh: 'A+',
    us_dating_date: null,
    us_ga_weeks: null,
    us_ga_days: null,
    pregnancy_type: 'SINGLETON',
    number_of_fetuses: 1,
    gender: null,
    is_deleted: false,
    created_at: new Date('2026-02-01T00:00:00.000Z'),
    updated_at: new Date('2026-02-01T00:00:00.000Z'),
    ...over,
  };
}

describe('PregnancyClinicalService', () => {
  let service: PregnancyClinicalService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let access: { assertVisitInOrg: jest.Mock };
  let validator: { validatePayload: jest.Mock };
  let eventBus: { publish: jest.Mock };
  let obgynHistory: { readEnvelope: jest.Mock };
  let episodeRouter: {
    resolveTrimesterOrder: jest.Mock;
    routeVisitToTrimester: jest.Mock;
  };

  beforeEach(async () => {
    db = {
      visit: {
        findFirst: jest.fn().mockResolvedValue({
          scheduled_at: new Date('2026-02-15T00:00:00.000Z'),
          episode: {
            id: 'episode-1',
            journey: {
              id: JOURNEY,
              patient_id: 'patient-1',
              care_path: { code: 'OBGYN_PREGNANCY' },
            },
          },
        }),
      },
      pregnancyJourneyRecord: { findUnique: jest.fn() },
      pregnancyEpisodeRecord: { findUnique: jest.fn().mockResolvedValue(null) },
      visitPregnancyRecord: { findUnique: jest.fn().mockResolvedValue(null) },
      visitFetalRecord: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };
    access = { assertVisitInOrg: jest.fn().mockResolvedValue(undefined) };
    validator = { validatePayload: jest.fn().mockResolvedValue({ ok: true }) };
    eventBus = { publish: jest.fn() };
    obgynHistory = {
      readEnvelope: jest.fn().mockResolvedValue({ blood_group_rh: 'A_POS' }),
    };
    episodeRouter = {
      resolveTrimesterOrder: jest.fn().mockReturnValue(null),
      routeVisitToTrimester: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PregnancyClinicalService,
        { provide: PrismaService, useValue: { db } },
        { provide: PatientAccessService, useValue: access },
        { provide: TemplateValidator, useValue: validator },
        { provide: EventBus, useValue: eventBus },
        { provide: ObgynHistoryService, useValue: obgynHistory },
        {
          provide: JourneyClinicalRegistry,
          useValue: { register: jest.fn(), resolve: jest.fn() },
        },
        { provide: PregnancyEpisodeRouterService, useValue: episodeRouter },
      ],
    }).compile();

    service = module.get(PregnancyClinicalService);
  });

  describe('GET', () => {
    it('builds a flat envelope with server-computed GA/EDD from LMP', async () => {
      db.pregnancyJourneyRecord.findUnique.mockResolvedValue(journeyRecord());

      const env = await service.get(VISIT, JOURNEY, user);

      // asOf = scheduled_at 2026-02-15, LMP 2026-01-01 → 45 days = 6w 3d.
      expect(env.journey_id).toBe(JOURNEY);
      expect(env.version).toBe(2);
      expect(env.lmp).toBe('2026-01-01');
      expect(env.ga_lmp).toBe('6w 3d');
      expect(env.edd_lmp).toBe('2026-10-08');
      // Blood group is folded in read-only from patient OB/GYN history.
      expect(obgynHistory.readEnvelope).toHaveBeenCalledWith('patient-1');
      // Raw enum (A_POS) is formatted to its display label for the surface.
      expect(env.blood_group_rh).toBe('A+');
      expect(env.fetuses).toEqual([]);
    });
  });

  describe('PATCH', () => {
    it('saves last-write-wins (no If-Match), bumps the version, emits journey.clinical.updated', async () => {
      // First findUnique = the pre-write read (v2); second = the trailing GET.
      db.pregnancyJourneyRecord.findUnique
        .mockResolvedValueOnce(journeyRecord())
        .mockResolvedValueOnce(
          journeyRecord({ version: 3, risk_level: 'HIGH' }),
        );

      const tx = {
        pregnancyJourneyRecordRevision: { create: jest.fn() },
        pregnancyJourneyRecord: {
          update: jest.fn().mockResolvedValue({ version: 3 }),
        },
      };
      db.$transaction.mockImplementation(
        (cb: (t: typeof tx) => Promise<number>) => cb(tx),
      );

      const env = await service.patch(
        VISIT,
        JOURNEY,
        { risk_level: 'HIGH' },
        user,
      );

      expect(validator.validatePayload).toHaveBeenCalledWith(
        'obgyn_pregnancy',
        { risk_level: 'HIGH' },
        { sparse: true },
      );
      // Revision snapshots the prior (v2) row; live row bumps to v3.
      expect(tx.pregnancyJourneyRecordRevision.create).toHaveBeenCalledTimes(1);
      expect(tx.pregnancyJourneyRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: { increment: 1 } }),
        }),
      );
      expect(eventBus.publish).toHaveBeenCalledWith(
        CLINICAL_EVENTS.journey.clinicalUpdated,
        expect.objectContaining({
          journey_id: JOURNEY,
          visit_id: VISIT,
          scopes: ['journey'],
          version: 3,
        }),
      );
      expect(env.version).toBe(3);
      // A non-dating edit must not touch episode routing.
      expect(episodeRouter.resolveTrimesterOrder).not.toHaveBeenCalled();
      expect(episodeRouter.routeVisitToTrimester).not.toHaveBeenCalled();
    });

    it('re-routes the visit to its trimester episode when dating changes, and routes episode-scoped writes to the moved-to episode', async () => {
      db.pregnancyJourneyRecord.findUnique
        .mockResolvedValueOnce(journeyRecord())
        .mockResolvedValueOnce(journeyRecord({ version: 3 }));
      episodeRouter.resolveTrimesterOrder.mockReturnValue(3);
      episodeRouter.routeVisitToTrimester.mockResolvedValue('episode-3');

      const tx = {
        pregnancyJourneyRecordRevision: { create: jest.fn() },
        pregnancyJourneyRecord: {
          update: jest.fn().mockResolvedValue({ version: 3 }),
        },
        pregnancyEpisodeRecordRevision: { create: jest.fn() },
        pregnancyEpisodeRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
        },
        visitPregnancyRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
        },
      };
      db.$transaction.mockImplementation(
        (cb: (t: typeof tx) => Promise<number>) => cb(tx),
      );

      await service.patch(
        VISIT,
        JOURNEY,
        { lmp: '2026-01-01', anomaly_scan: { result: 'normal' } },
        user,
      );

      // Resolved from the UPDATED record + the open visit's scheduled_at.
      expect(episodeRouter.resolveTrimesterOrder).toHaveBeenCalledWith(
        { version: 3 },
        new Date('2026-02-15T00:00:00.000Z'),
      );
      expect(episodeRouter.routeVisitToTrimester).toHaveBeenCalledWith(
        tx,
        JOURNEY,
        VISIT,
        3,
      );
      // Episode-scoped labs land on the moved-to episode, not the stale one.
      expect(tx.pregnancyEpisodeRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ episode_id: 'episode-3' }),
        }),
      );
    });

    it('does not re-route when dating changes but no trimester resolves (no Episode-1 fallback)', async () => {
      db.pregnancyJourneyRecord.findUnique
        .mockResolvedValueOnce(journeyRecord())
        .mockResolvedValueOnce(journeyRecord({ version: 3 }));
      episodeRouter.resolveTrimesterOrder.mockReturnValue(null);

      const tx = {
        pregnancyJourneyRecordRevision: { create: jest.fn() },
        pregnancyJourneyRecord: {
          update: jest.fn().mockResolvedValue({ version: 3 }),
        },
        pregnancyEpisodeRecordRevision: { create: jest.fn() },
        pregnancyEpisodeRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
        },
        visitPregnancyRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
        },
      };
      db.$transaction.mockImplementation(
        (cb: (t: typeof tx) => Promise<number>) => cb(tx),
      );

      await service.patch(VISIT, JOURNEY, { lmp: '2026-01-01' }, user);

      expect(episodeRouter.resolveTrimesterOrder).toHaveBeenCalled();
      expect(episodeRouter.routeVisitToTrimester).not.toHaveBeenCalled();
    });
  });
});
