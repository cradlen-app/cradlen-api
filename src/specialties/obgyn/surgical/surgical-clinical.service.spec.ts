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

// The journey's three phase episodes (Pre-op=1 / Surgery=2 / Post-op=3). The
// current visit sits on the Pre-op episode ('episode-1').
const PHASE_EPISODES = [
  { id: 'episode-1', order: 1 },
  { id: 'episode-2', order: 2 },
  { id: 'episode-3', order: 3 },
];

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
  let obgynHistory: {
    readEnvelope: jest.Mock;
    applyPatch: jest.Mock;
    upsertJourneyGynSurgeryRow: jest.Mock;
  };
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
      patientEpisode: {
        findMany: jest.fn().mockResolvedValue(PHASE_EPISODES),
      },
      surgicalJourneyRecord: { findUnique: jest.fn() },
      surgicalEpisodeRecord: { findMany: jest.fn().mockResolvedValue([]) },
      visitSurgicalRecord: { findUnique: jest.fn().mockResolvedValue(null) },
      pregnancyJourneyRecord: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    access = { assertVisitInOrg: jest.fn().mockResolvedValue(undefined) };
    validator = { validatePayload: jest.fn().mockResolvedValue({ ok: true }) };
    eventBus = { publish: jest.fn() };
    obgynHistory = {
      readEnvelope: jest.fn().mockResolvedValue({ blood_group_rh: 'O_POS' }),
      applyPatch: jest.fn().mockResolvedValue(undefined),
      upsertJourneyGynSurgeryRow: jest.fn().mockResolvedValue(undefined),
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
    it('aggregates all three phase-episode records, folds blood group + the patient-history linked_summary, and reports the current phase', async () => {
      db.surgicalJourneyRecord.findUnique.mockResolvedValue(journeyRecord());
      db.surgicalEpisodeRecord.findMany.mockResolvedValue([
        {
          episode_id: 'episode-1',
          preop_assessment: { asa_class: 'ASA_II' },
          operative_summary: null,
          postop_summary: null,
        },
        {
          episode_id: 'episode-2',
          preop_assessment: null,
          operative_summary: { procedure_performed: 'Myomectomy', ebl_ml: 300 },
          postop_summary: null,
        },
        {
          episode_id: 'episode-3',
          preop_assessment: null,
          operative_summary: null,
          postop_summary: { discharge_decision: 'DISCHARGED' },
        },
      ]);

      const env = await service.get(VISIT, JOURNEY, user);

      expect(env.journey_id).toBe(JOURNEY);
      expect(env.version).toBe(2);
      expect(env.procedure_name).toBe('Myomectomy');
      expect(env.surgery_date).toBe('2026-06-15');
      // Each phase blob is sourced from its OWN order-keyed episode record.
      expect(env.preop_assessment).toEqual({ asa_class: 'ASA_II' });
      expect(env.operative_summary).toEqual({
        procedure_performed: 'Myomectomy',
        ebl_ml: 300,
      });
      expect(env.postop_summary).toEqual({ discharge_decision: 'DISCHARGED' });
      // The current visit sits on the Pre-op (order-1) episode.
      expect(env.current_phase_order).toBe(1);
      // Blood group is surfaced RAW (for the editable SELECT) from OB/GYN
      // history; the linked_summary display formats it.
      expect(obgynHistory.readEnvelope).toHaveBeenCalledWith('patient-1');
      expect(env.blood_group_rh).toBe('O_POS');
      expect(env.linked_summary).toEqual(
        expect.objectContaining({
          kind: 'PATIENT_HISTORY',
          blood_group_rh: 'O+',
        }),
      );
    });

    it('folds the source pregnancy journey into linked_summary for a cesarean (blood group still surfaced)', async () => {
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
      // Blood group is still read + surfaced (raw) independently of the link.
      expect(env.blood_group_rh).toBe('O_POS');
    });
  });

  describe('PATCH', () => {
    function makeTx() {
      return {
        patientEpisode: {
          findMany: jest.fn().mockResolvedValue(PHASE_EPISODES),
        },
        surgicalJourneyRecordRevision: { create: jest.fn() },
        surgicalJourneyRecord: {
          update: jest.fn().mockResolvedValue({ version: 3 }),
        },
        surgicalEpisodeRecordRevision: { create: jest.fn() },
        surgicalEpisodeRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
          update: jest.fn(),
        },
        visitSurgicalRecordRevision: { create: jest.fn() },
        visitSurgicalRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
          update: jest.fn(),
        },
      };
    }

    it('demuxes each phase blob to its own order-keyed episode record, snapshots the journey revision, bumps the version, emits the event', async () => {
      db.surgicalJourneyRecord.findUnique
        .mockResolvedValueOnce(journeyRecord())
        .mockResolvedValueOnce(journeyRecord({ version: 3 }));

      const tx = makeTx();
      db.$transaction.mockImplementation(
        (cb: (t: typeof tx) => Promise<number>) => cb(tx),
      );

      const env = await service.patch(
        VISIT,
        JOURNEY,
        {
          procedure_name: 'Total hysterectomy',
          preop_assessment: { asa_class: 'ASA_II' },
          operative_summary: { procedure_performed: 'TAH-BSO', ebl_ml: 350 },
          postop_summary: { discharge_decision: 'DISCHARGED' },
          interval_history: 'Recovering well',
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
      // Pre-op → order-1 episode; operative → order-2; post-op → order-3.
      expect(tx.surgicalEpisodeRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            episode_id: 'episode-1',
            preop_assessment: { asa_class: 'ASA_II' },
          }),
        }),
      );
      expect(tx.surgicalEpisodeRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            episode_id: 'episode-2',
            operative_summary: { procedure_performed: 'TAH-BSO', ebl_ml: 350 },
          }),
        }),
      );
      expect(tx.surgicalEpisodeRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            episode_id: 'episode-3',
            postop_summary: { discharge_decision: 'DISCHARGED' },
          }),
        }),
      );
      // Per-visit follow-up lands on the visit record.
      expect(tx.visitSurgicalRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            visit_id: VISIT,
            interval_history: 'Recovering well',
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

    it('writes blood group through to patient OB/GYN history (applyPatch) in-tx', async () => {
      db.surgicalJourneyRecord.findUnique
        .mockResolvedValueOnce(journeyRecord())
        .mockResolvedValueOnce(journeyRecord({ version: 3 }));

      const tx = makeTx();
      db.$transaction.mockImplementation(
        (cb: (t: typeof tx) => Promise<number>) => cb(tx),
      );

      await service.patch(VISIT, JOURNEY, { blood_group_rh: 'A_POS' }, user);

      expect(obgynHistory.applyPatch).toHaveBeenCalledWith(
        tx,
        'patient-1',
        { blood_group_rh: 'A_POS' },
        null,
        'profile-A',
      );
      expect(eventBus.publish).toHaveBeenCalledWith(
        CLINICAL_EVENTS.journey.clinicalUpdated,
        expect.objectContaining({
          scopes: expect.arrayContaining(['patient_history']),
        }),
      );
    });

    it('writes the operative note to the order-2 episode even from a post-op visit (phase writes are order-keyed, not visit-anchored)', async () => {
      // The current visit sits on the Post-op (order-3) episode this time.
      db.visit.findFirst.mockResolvedValue({
        scheduled_at: new Date('2026-06-25T00:00:00.000Z'),
        episode: {
          id: 'episode-3',
          journey: {
            id: JOURNEY,
            patient_id: 'patient-1',
            care_path: { code: 'OBGYN_SURGICAL' },
          },
        },
      });
      db.surgicalJourneyRecord.findUnique
        .mockResolvedValueOnce(journeyRecord())
        .mockResolvedValueOnce(journeyRecord({ version: 3 }));

      const tx = makeTx();
      db.$transaction.mockImplementation(
        (cb: (t: typeof tx) => Promise<number>) => cb(tx),
      );

      await service.patch(
        VISIT,
        JOURNEY,
        { operative_summary: { procedure_performed: 'TAH-BSO' } },
        user,
      );

      // Lands on the Surgery (order-2) episode, not the current (order-3) one.
      expect(tx.surgicalEpisodeRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ episode_id: 'episode-2' }),
        }),
      );
    });

    it('re-routes the visit onto its phase episode for the timeline when surgery_date changes', async () => {
      db.surgicalJourneyRecord.findUnique
        .mockResolvedValueOnce(journeyRecord())
        .mockResolvedValueOnce(journeyRecord({ version: 3 }));
      episodeRouter.resolveEpisodeOrder.mockReturnValue(3);
      episodeRouter.routeVisitToEpisode.mockResolvedValue('episode-3');

      const tx = makeTx();
      tx.surgicalJourneyRecord.update.mockResolvedValue({
        version: 3,
        surgery_date: new Date('2026-06-15T00:00:00.000Z'),
      });
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
      // The post-op blob still lands on the order-3 episode regardless of routing.
      expect(tx.surgicalEpisodeRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ episode_id: 'episode-3' }),
        }),
      );
    });

    it('does not re-route when surgery_date changes but no phase resolves (no fallback)', async () => {
      db.surgicalJourneyRecord.findUnique
        .mockResolvedValueOnce(journeyRecord())
        .mockResolvedValueOnce(journeyRecord({ version: 3 }));
      episodeRouter.resolveEpisodeOrder.mockReturnValue(null);

      const tx = makeTx();
      tx.surgicalJourneyRecord.update.mockResolvedValue({
        version: 3,
        surgery_date: null,
      });
      db.$transaction.mockImplementation(
        (cb: (t: typeof tx) => Promise<number>) => cb(tx),
      );

      await service.patch(VISIT, JOURNEY, { surgery_date: '2026-06-15' }, user);

      expect(episodeRouter.resolveEpisodeOrder).toHaveBeenCalled();
      expect(episodeRouter.routeVisitToEpisode).not.toHaveBeenCalled();
    });

    it('re-syncs the gyn_surgeries history row from the updated ACTIVE record on a Journey-section save', async () => {
      db.surgicalJourneyRecord.findUnique
        .mockResolvedValueOnce(journeyRecord())
        .mockResolvedValueOnce(journeyRecord({ version: 3 }));

      const tx = makeTx();
      tx.surgicalJourneyRecord.update.mockResolvedValue({
        version: 3,
        status: 'ACTIVE',
        procedure_code: 'CESAREAN_SECTION',
        procedure_name: 'Cesarean section',
        surgery_date: new Date('2026-07-20T00:00:00.000Z'),
        planned_date: null,
      });
      db.$transaction.mockImplementation(
        (cb: (t: typeof tx) => Promise<number>) => cb(tx),
      );

      await service.patch(
        VISIT,
        JOURNEY,
        {
          procedure_name: 'Cesarean section',
          procedure_code: 'CESAREAN_SECTION',
        },
        user,
      );

      expect(obgynHistory.upsertJourneyGynSurgeryRow).toHaveBeenCalledWith(
        tx,
        'patient-1',
        JOURNEY,
        {
          outcome: 'PLANNED',
          procedure_code: 'CESAREAN_SECTION',
          procedure_name: 'Cesarean section',
          surgery_date: '2026-07-20',
        },
        'profile-A',
      );
    });

    it('does NOT touch the history row when only phase/visit fields are saved', async () => {
      db.surgicalJourneyRecord.findUnique
        .mockResolvedValueOnce(journeyRecord())
        .mockResolvedValueOnce(journeyRecord({ version: 3 }));

      const tx = makeTx();
      tx.surgicalJourneyRecord.update.mockResolvedValue({
        version: 3,
        status: 'ACTIVE',
      });
      db.$transaction.mockImplementation(
        (cb: (t: typeof tx) => Promise<number>) => cb(tx),
      );

      await service.patch(
        VISIT,
        JOURNEY,
        { interval_history: 'Recovering well' },
        user,
      );

      expect(obgynHistory.upsertJourneyGynSurgeryRow).not.toHaveBeenCalled();
    });

    it('does NOT regress a CLOSED journey — no history sync on post-close edits', async () => {
      db.surgicalJourneyRecord.findUnique
        .mockResolvedValueOnce(journeyRecord({ status: 'CLOSED' }))
        .mockResolvedValueOnce(journeyRecord({ status: 'CLOSED', version: 3 }));

      const tx = makeTx();
      tx.surgicalJourneyRecord.update.mockResolvedValue({
        version: 3,
        status: 'CLOSED',
        procedure_code: 'MYOMECTOMY',
      });
      db.$transaction.mockImplementation(
        (cb: (t: typeof tx) => Promise<number>) => cb(tx),
      );

      await service.patch(
        VISIT,
        JOURNEY,
        { procedure_name: 'Myomectomy (revised)' },
        user,
      );

      expect(obgynHistory.upsertJourneyGynSurgeryRow).not.toHaveBeenCalled();
    });
  });
});
