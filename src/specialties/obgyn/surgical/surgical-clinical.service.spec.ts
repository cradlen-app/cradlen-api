import { Test, TestingModule } from '@nestjs/testing';
import { SurgicalClinicalService } from './surgical-clinical.service';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.service';
import { TemplateValidator } from '@builder/validator/template.validator';
import { EventBus } from '@infrastructure/messaging/event-bus';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { CLINICAL_EVENTS } from '@core/clinical/events/clinical-events';
import { ObgynHistoryService } from '../patient-history/obgyn-history.service';
import { JourneyClinicalRegistry } from '../journeys/journey-clinical.registry';
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
const JOURNEY = 'journey-1';

function journeyRecord(over: Record<string, unknown> = {}) {
  return {
    id: 'sjr-1',
    journey_id: JOURNEY,
    version: 2,
    status: 'ACTIVE',
    procedure_id: null,
    procedure_code: 'MYOMECTOMY',
    procedure_name: 'Myomectomy',
    indication: 'Fibroids',
    planned_date: null,
    surgery_date: new Date('2026-06-15T00:00:00.000Z'),
    anesthesia_type: 'GENERAL',
    urgency: 'ELECTIVE',
    source_pregnancy_journey_id: null,
    outcome: null,
    is_deleted: false,
    created_at: new Date('2026-06-01T00:00:00.000Z'),
    updated_at: new Date('2026-06-01T00:00:00.000Z'),
    ...over,
  };
}

describe('SurgicalClinicalService', () => {
  let service: SurgicalClinicalService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let access: { assertVisitInOrg: jest.Mock };
  let validator: { validatePayload: jest.Mock };
  let eventBus: { publish: jest.Mock };
  let obgynHistory: { readEnvelope: jest.Mock };
  let episodeRouter: {
    resolveEpisodeOrder: jest.Mock;
    routeVisitToEpisode: jest.Mock;
  };

  beforeEach(async () => {
    db = {
      visit: {
        findFirst: jest.fn().mockResolvedValue({
          scheduled_at: new Date('2026-06-20T00:00:00.000Z'),
          episode: {
            id: 'episode-1',
            journey: {
              id: JOURNEY,
              patient_id: 'patient-1',
              care_path: { code: 'OBGYN_SURGICAL' },
            },
          },
        }),
      },
      surgicalJourneyRecord: { findUnique: jest.fn() },
      surgicalEpisodeRecord: { findUnique: jest.fn().mockResolvedValue(null) },
      visitSurgicalRecord: { findUnique: jest.fn().mockResolvedValue(null) },
      pregnancyJourneyRecord: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    access = { assertVisitInOrg: jest.fn().mockResolvedValue(undefined) };
    validator = { validatePayload: jest.fn().mockResolvedValue({ ok: true }) };
    eventBus = { publish: jest.fn() };
    obgynHistory = {
      readEnvelope: jest.fn().mockResolvedValue({ blood_group_rh: 'O_POS' }),
    };
    episodeRouter = {
      resolveEpisodeOrder: jest.fn().mockReturnValue(null),
      routeVisitToEpisode: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SurgicalClinicalService,
        { provide: PrismaService, useValue: { db } },
        { provide: PatientAccessService, useValue: access },
        { provide: TemplateValidator, useValue: validator },
        { provide: EventBus, useValue: eventBus },
        { provide: ObgynHistoryService, useValue: obgynHistory },
        {
          provide: JourneyClinicalRegistry,
          useValue: { register: jest.fn(), resolve: jest.fn() },
        },
        { provide: SurgicalEpisodeRouterService, useValue: episodeRouter },
      ],
    }).compile();

    service = module.get(SurgicalClinicalService);
  });

  describe('GET', () => {
    it('builds a flat envelope and folds the patient-history linked_summary (no source pregnancy)', async () => {
      db.surgicalJourneyRecord.findUnique.mockResolvedValue(journeyRecord());

      const env = await service.get(VISIT, JOURNEY, user);

      expect(env.journey_id).toBe(JOURNEY);
      expect(env.version).toBe(2);
      expect(env.procedure_name).toBe('Myomectomy');
      expect(env.surgery_date).toBe('2026-06-15');
      // No source pregnancy → linked_summary mirrors patient OB/GYN history.
      expect(obgynHistory.readEnvelope).toHaveBeenCalledWith('patient-1');
      expect(env.linked_summary).toEqual(
        expect.objectContaining({
          kind: 'PATIENT_HISTORY',
          blood_group_rh: 'O+',
        }),
      );
    });

    it('folds the source pregnancy journey into linked_summary for a cesarean', async () => {
      db.surgicalJourneyRecord.findUnique.mockResolvedValue(
        journeyRecord({
          procedure_code: 'CESAREAN_SECTION',
          procedure_name: 'Cesarean section',
          source_pregnancy_journey_id: 'preg-journey',
        }),
      );
      db.pregnancyJourneyRecord.findUnique.mockResolvedValue({
        journey_id: 'preg-journey',
        risk_level: 'HIGH',
        lmp: new Date('2025-09-01T00:00:00.000Z'),
        pregnancy_type: 'SINGLETON',
        number_of_fetuses: 1,
        delivery_plan: {
          outcome_type: 'LIVE_BIRTH',
          delivery_mode: 'CESAREAN',
        },
      });

      const env = await service.get(VISIT, JOURNEY, user);

      expect(db.pregnancyJourneyRecord.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { journey_id: 'preg-journey' } }),
      );
      expect(env.linked_summary).toEqual(
        expect.objectContaining({
          kind: 'PREGNANCY',
          journey_id: 'preg-journey',
          risk_level: 'HIGH',
        }),
      );
      // Patient-history read is not used on the cesarean path.
      expect(obgynHistory.readEnvelope).not.toHaveBeenCalled();
    });
  });

  describe('PATCH', () => {
    it('demuxes journey/episode/visit, snapshots a revision, bumps the version, emits the event', async () => {
      db.surgicalJourneyRecord.findUnique
        .mockResolvedValueOnce(journeyRecord())
        .mockResolvedValueOnce(journeyRecord({ version: 3 }));

      const tx = {
        surgicalJourneyRecordRevision: { create: jest.fn() },
        surgicalJourneyRecord: {
          update: jest.fn().mockResolvedValue({ version: 3 }),
        },
        surgicalEpisodeRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
        },
        visitSurgicalRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
        },
      };
      db.$transaction.mockImplementation(
        (cb: (t: typeof tx) => Promise<number>) => cb(tx),
      );

      const env = await service.patch(
        VISIT,
        JOURNEY,
        {
          procedure_name: 'Total hysterectomy',
          preop_assessment: { asa_class: 'ASA_II' },
          procedure_performed: 'TAH-BSO',
          estimated_blood_loss_ml: '350',
        },
        user,
      );

      expect(validator.validatePayload).toHaveBeenCalledWith(
        'obgyn_surgical',
        expect.objectContaining({ procedure_name: 'Total hysterectomy' }),
        { sparse: true },
      );
      // Journey revision snapshots the prior (v2) row; live row bumps to v3.
      expect(tx.surgicalJourneyRecordRevision.create).toHaveBeenCalledTimes(1);
      expect(tx.surgicalJourneyRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: { increment: 1 } }),
        }),
      );
      // Episode + visit scopes are demuxed into their own records.
      expect(tx.surgicalEpisodeRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            episode_id: 'episode-1',
            preop_assessment: { asa_class: 'ASA_II' },
          }),
        }),
      );
      expect(tx.visitSurgicalRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            visit_id: VISIT,
            procedure_performed: 'TAH-BSO',
            // string → integer coercion for the INT column.
            estimated_blood_loss_ml: 350,
          }),
        }),
      );
      expect(eventBus.publish).toHaveBeenCalledWith(
        CLINICAL_EVENTS.journey.clinicalUpdated,
        expect.objectContaining({
          journey_id: JOURNEY,
          visit_id: VISIT,
          scopes: expect.arrayContaining(['journey', 'episode', 'visit']),
          version: 3,
        }),
      );
      expect(env.version).toBe(3);
      // A non-routing edit (procedure_name) must not touch episode routing.
      expect(episodeRouter.resolveEpisodeOrder).not.toHaveBeenCalled();
      expect(episodeRouter.routeVisitToEpisode).not.toHaveBeenCalled();
    });

    it('re-routes the visit to its phase episode when surgery_date changes, and routes episode-scoped writes to the moved-to episode', async () => {
      db.surgicalJourneyRecord.findUnique
        .mockResolvedValueOnce(journeyRecord())
        .mockResolvedValueOnce(journeyRecord({ version: 3 }));
      episodeRouter.resolveEpisodeOrder.mockReturnValue(3);
      episodeRouter.routeVisitToEpisode.mockResolvedValue('episode-postop');

      const tx = {
        surgicalJourneyRecordRevision: { create: jest.fn() },
        surgicalJourneyRecord: {
          update: jest.fn().mockResolvedValue({
            version: 3,
            surgery_date: new Date('2026-06-15T00:00:00.000Z'),
          }),
        },
        surgicalEpisodeRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
        },
        visitSurgicalRecord: {
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
        { surgery_date: '2026-06-15', postop_summary: { note: 'stable' } },
        user,
      );

      // Resolved from the UPDATED surgery_date + the open visit's scheduled_at.
      expect(episodeRouter.resolveEpisodeOrder).toHaveBeenCalledWith(
        new Date('2026-06-15T00:00:00.000Z'),
        new Date('2026-06-20T00:00:00.000Z'),
      );
      expect(episodeRouter.routeVisitToEpisode).toHaveBeenCalledWith(
        tx,
        JOURNEY,
        VISIT,
        3,
      );
      // Episode-scoped writes land on the moved-to episode, not the stale one.
      expect(tx.surgicalEpisodeRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ episode_id: 'episode-postop' }),
        }),
      );
    });

    it('does not re-route when surgery_date changes but no phase resolves (no fallback)', async () => {
      db.surgicalJourneyRecord.findUnique
        .mockResolvedValueOnce(journeyRecord())
        .mockResolvedValueOnce(journeyRecord({ version: 3 }));
      episodeRouter.resolveEpisodeOrder.mockReturnValue(null);

      const tx = {
        surgicalJourneyRecordRevision: { create: jest.fn() },
        surgicalJourneyRecord: {
          update: jest
            .fn()
            .mockResolvedValue({ version: 3, surgery_date: null }),
        },
        surgicalEpisodeRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
        },
        visitSurgicalRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
        },
      };
      db.$transaction.mockImplementation(
        (cb: (t: typeof tx) => Promise<number>) => cb(tx),
      );

      await service.patch(VISIT, JOURNEY, { surgery_date: '2026-06-15' }, user);

      expect(episodeRouter.resolveEpisodeOrder).toHaveBeenCalled();
      expect(episodeRouter.routeVisitToEpisode).not.toHaveBeenCalled();
    });
  });
});
