import { ObgynHistoryService } from './obgyn-history.service';
import type { UpdateObgynHistoryDto } from './dto/obgyn-history.dto';

// Minimal mock transaction client exposing only what applyPatch touches.
function createTx(singleton: Record<string, unknown>) {
  const update = jest.fn(({ data }: { data: Record<string, unknown> }) => ({
    ...singleton,
    ...data,
    version: (singleton.version as number) + 1,
  }));
  return {
    tx: {
      patientObgynHistory: {
        findUnique: jest.fn().mockResolvedValue(singleton),
        create: jest.fn(),
        update,
      },
      patientObgynHistoryRevision: { create: jest.fn() },
    },
    update,
  };
}

function makeService() {
  const eventBus = { publish: jest.fn() };
  const service = new ObgynHistoryService(
    {} as never, // PrismaService — unused by applyPatch
    {} as never, // PatientAccessService — unused by applyPatch
    eventBus as never,
  );
  return { service, eventBus };
}

function baseSingleton(overrides: Record<string, unknown> = {}) {
  return {
    id: 'h1',
    patient_id: 'p1',
    version: 2,
    section_timestamps: null,
    obstetric_summary: null,
    pregnancies: null,
    contraceptives: null,
    non_gyn_surgeries: null,
    gyn_surgeries: null,
    family_members: null,
    medications: null,
    allergies: null,
    ...overrides,
  };
}

const PROFILE = 'profile-1';

/** Pull the `data` arg passed to the singleton update. */
function dataArg(update: jest.Mock): Record<string, unknown> {
  return update.mock.calls[0][0].data as Record<string, unknown>;
}

describe('ObgynHistoryService.applyPatch (JSON-array collections)', () => {
  it('creates a row: assigns an id + provenance, keeps provided fields', async () => {
    const { service, eventBus } = makeService();
    const { tx, update } = createTx(baseSingleton());

    const dto = {
      allergies: [{ allergy_to: 'Penicillin', severity: 'SEVERE' }],
    } as unknown as UpdateObgynHistoryDto;

    await service.applyPatch(tx as never, 'p1', dto, null, PROFILE);

    const allergies = dataArg(update).allergies as Array<
      Record<string, unknown>
    >;
    expect(allergies).toHaveLength(1);
    expect(allergies[0]).toMatchObject({
      allergy_to: 'Penicillin',
      severity: 'SEVERE',
      created_by_id: PROFILE,
    });
    expect(typeof allergies[0].id).toBe('string');
    expect(typeof allergies[0].created_at).toBe('string');
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    expect(tx.patientObgynHistoryRevision.create).toHaveBeenCalledTimes(1);
  });

  it('updates a row by id: field-merges over the prior row', async () => {
    const { service } = makeService();
    const { tx, update } = createTx(
      baseSingleton({
        allergies: [
          {
            id: 'a1',
            allergy_to: 'Latex',
            severity: 'MILD',
            created_by_id: 'x',
          },
        ],
      }),
    );

    const dto = {
      allergies: [{ id: 'a1', severity: 'SEVERE' }],
    } as unknown as UpdateObgynHistoryDto;

    await service.applyPatch(tx as never, 'p1', dto, null, PROFILE);

    const allergies = dataArg(update).allergies as Array<
      Record<string, unknown>
    >;
    expect(allergies).toHaveLength(1);
    expect(allergies[0]).toMatchObject({
      id: 'a1',
      allergy_to: 'Latex', // preserved
      severity: 'SEVERE', // overwritten
    });
  });

  it('deletes a row: a live id absent from the body is dropped', async () => {
    const { service } = makeService();
    const { tx, update } = createTx(
      baseSingleton({
        allergies: [
          { id: 'a1', allergy_to: 'Latex' },
          { id: 'a2', allergy_to: 'Peanut' },
        ],
      }),
    );

    const dto = {
      allergies: [{ id: 'a1' }],
    } as unknown as UpdateObgynHistoryDto;

    await service.applyPatch(tx as never, 'p1', dto, null, PROFILE);

    const allergies = dataArg(update).allergies as Array<
      Record<string, unknown>
    >;
    expect(allergies.map((a) => a.id)).toEqual(['a1']);
  });

  it('clears a collection when sent as []', async () => {
    const { service } = makeService();
    const { tx, update } = createTx(
      baseSingleton({ allergies: [{ id: 'a1', allergy_to: 'Latex' }] }),
    );

    const dto = { allergies: [] } as unknown as UpdateObgynHistoryDto;
    await service.applyPatch(tx as never, 'p1', dto, null, PROFILE);

    expect(dataArg(update).allergies).toEqual([]);
  });

  it('leaves an omitted collection untouched (no data key)', async () => {
    const { service } = makeService();
    const { tx, update } = createTx(
      baseSingleton({ allergies: [{ id: 'a1', allergy_to: 'Latex' }] }),
    );

    const dto = {
      medications: [{ drug_name: 'Folic acid' }],
    } as unknown as UpdateObgynHistoryDto;

    await service.applyPatch(tx as never, 'p1', dto, null, PROFILE);

    const data = dataArg(update);
    expect('allergies' in data).toBe(false);
    expect('medications' in data).toBe(true);
  });

  it('recomputes obstetric_summary from the resulting pregnancies', async () => {
    const { service } = makeService();
    const { tx, update } = createTx(baseSingleton());

    const dto = {
      pregnancies: [
        { outcome: 'LIVE_BIRTH', gestational_age_weeks: 40 },
        { outcome: 'STILLBIRTH', gestational_age_weeks: 24 },
        { outcome: 'MISCARRIAGE' },
      ],
    } as unknown as UpdateObgynHistoryDto;

    await service.applyPatch(tx as never, 'p1', dto, null, PROFILE);

    expect(dataArg(update).obstetric_summary).toEqual({
      gravida: 3,
      para: 2, // live birth + viable stillbirth
      abortion: 1,
      ectopic: 0,
      stillbirths: 1,
    });
  });

  it('derives all 5 counters: ectopic counts in both abortion and ectopic; the viability rule gates para only', async () => {
    const { service } = makeService();
    const { tx, update } = createTx(baseSingleton());

    const dto = {
      pregnancies: [
        { outcome: 'LIVE_BIRTH', gestational_age_weeks: 39 },
        { outcome: 'STILLBIRTH', gestational_age_weeks: 24 }, // viable → para
        { outcome: 'STILLBIRTH', gestational_age_weeks: 18 }, // pre-viable
        { outcome: 'ECTOPIC' },
        { outcome: 'ABORTION' },
        { outcome: 'ONGOING' }, // gravida only
        { outcome: 'OTHER' }, // gravida only
      ],
    } as unknown as UpdateObgynHistoryDto;

    await service.applyPatch(tx as never, 'p1', dto, null, PROFILE);

    expect(dataArg(update).obstetric_summary).toEqual({
      gravida: 7,
      para: 2,
      abortion: 2, // ectopic + abortion
      ectopic: 1,
      stillbirths: 2, // both stillbirth rows, regardless of GA
    });
  });

  it('respects an explicit obstetric_summary over the recompute', async () => {
    const { service } = makeService();
    const { tx, update } = createTx(baseSingleton());

    const dto = {
      pregnancies: [{ outcome: 'LIVE_BIRTH', gestational_age_weeks: 40 }],
      obstetric_summary: { gravida: 5, para: 4, abortion: 0 },
    } as unknown as UpdateObgynHistoryDto;

    await service.applyPatch(tx as never, 'p1', dto, null, PROFILE);

    expect(dataArg(update).obstetric_summary).toEqual({
      gravida: 5,
      para: 4,
      abortion: 0,
    });
  });

  it('is a no-op for an empty body (no update, no event)', async () => {
    const { service, eventBus } = makeService();
    const { tx, update } = createTx(baseSingleton());

    const result = await service.applyPatch(
      tx as never,
      'p1',
      {} as UpdateObgynHistoryDto,
      null,
      PROFILE,
    );

    expect(update).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'h1', version: 2 });
  });
});

describe('ObgynHistoryService.upsertJourneyPregnancyRow (GTPAL sync)', () => {
  const JOURNEY = 'journey-1';

  function pregnancies(update: jest.Mock): Array<Record<string, unknown>> {
    return dataArg(update).pregnancies as Array<Record<string, unknown>>;
  }

  it('appends an ONGOING row tagged with the journey and recomputes the summary', async () => {
    const { service, eventBus } = makeService();
    const { tx, update } = createTx(baseSingleton());

    await service.upsertJourneyPregnancyRow(
      tx as never,
      'p1',
      JOURNEY,
      { outcome: 'ONGOING' },
      PROFILE,
    );

    const rows = pregnancies(update);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: 'ONGOING',
      journey_id: JOURNEY,
      created_by_id: PROFILE,
    });
    expect(dataArg(update).obstetric_summary).toEqual({
      gravida: 1,
      para: 0,
      abortion: 0,
      ectopic: 0,
      stillbirths: 0,
    });
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('lazy-creates the history singleton for a patient without one', async () => {
    const { service } = makeService();
    const created = baseSingleton();
    const update = jest.fn(({ data }: { data: Record<string, unknown> }) => ({
      ...created,
      ...data,
    }));
    const tx = {
      patientObgynHistory: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
        update,
      },
      patientObgynHistoryRevision: { create: jest.fn() },
    };

    await service.upsertJourneyPregnancyRow(
      tx as never,
      'p1',
      JOURNEY,
      { outcome: 'ONGOING' },
      PROFILE,
    );

    // Once by the helper, once by the delegated applyPatch — both tolerate
    // the pre-existing row returned by findUnique on the second call.
    expect(tx.patientObgynHistory.create).toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('adopts the most recent untagged ONGOING row instead of appending (no double gravida)', async () => {
    const { service } = makeService();
    const { tx, update } = createTx(
      baseSingleton({
        pregnancies: [
          {
            id: 'r-old',
            outcome: 'ONGOING',
            created_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 'r-new',
            outcome: 'ONGOING',
            created_at: '2026-06-01T00:00:00Z',
          },
          { id: 'r-done', outcome: 'LIVE_BIRTH', gestational_age_weeks: 40 },
        ],
      }),
    );

    await service.upsertJourneyPregnancyRow(
      tx as never,
      'p1',
      JOURNEY,
      { outcome: 'ONGOING' },
      PROFILE,
    );

    const rows = pregnancies(update);
    expect(rows).toHaveLength(3); // adopted, not appended
    expect(rows.find((r) => r.id === 'r-new')).toMatchObject({
      journey_id: JOURNEY,
    });
    expect(rows.find((r) => r.id === 'r-old')?.journey_id).toBeUndefined();
  });

  it('finalizes the journey-tagged row on close and updates the counters', async () => {
    const { service } = makeService();
    const { tx, update } = createTx(
      baseSingleton({
        pregnancies: [
          { id: 'r1', outcome: 'ONGOING', journey_id: JOURNEY },
          { id: 'r2', outcome: 'MISCARRIAGE' },
        ],
      }),
    );

    await service.upsertJourneyPregnancyRow(
      tx as never,
      'p1',
      JOURNEY,
      {
        outcome: 'LIVE_BIRTH',
        mode_of_delivery: 'CESAREAN',
        gestational_age_weeks: 38,
        birth_date: '2026-07-16',
      },
      PROFILE,
    );

    const rows = pregnancies(update);
    expect(rows.find((r) => r.id === 'r1')).toMatchObject({
      outcome: 'LIVE_BIRTH',
      mode_of_delivery: 'CESAREAN',
      gestational_age_weeks: 38,
      birth_date: '2026-07-16',
      journey_id: JOURNEY,
    });
    expect(dataArg(update).obstetric_summary).toEqual({
      gravida: 2,
      para: 1,
      abortion: 1,
      ectopic: 0,
      stillbirths: 0,
    });
  });

  it('appends at close when no tagged or adoptable row exists (pre-feature pregnancy)', async () => {
    const { service } = makeService();
    const { tx, update } = createTx(
      baseSingleton({
        pregnancies: [{ id: 'r1', outcome: 'LIVE_BIRTH' }],
      }),
    );

    await service.upsertJourneyPregnancyRow(
      tx as never,
      'p1',
      JOURNEY,
      { outcome: 'ECTOPIC', birth_date: '2026-07-01' },
      PROFILE,
    );

    const rows = pregnancies(update);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      outcome: 'ECTOPIC',
      journey_id: JOURNEY,
    });
  });

  it('is idempotent: an in-sync target writes nothing (no version churn, revision, or event)', async () => {
    const { service, eventBus } = makeService();
    const { tx, update } = createTx(
      baseSingleton({
        pregnancies: [{ id: 'r1', outcome: 'ONGOING', journey_id: JOURNEY }],
      }),
    );

    await service.upsertJourneyPregnancyRow(
      tx as never,
      'p1',
      JOURNEY,
      { outcome: 'ONGOING' },
      PROFILE,
    );

    expect(update).not.toHaveBeenCalled();
    expect(tx.patientObgynHistoryRevision.create).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('leaves other collections and unrelated pregnancy rows untouched', async () => {
    const { service } = makeService();
    const { tx, update } = createTx(
      baseSingleton({
        pregnancies: [{ id: 'r1', outcome: 'MISCARRIAGE', notes: 'keep me' }],
        allergies: [{ id: 'a1', allergy_to: 'Latex' }],
      }),
    );

    await service.upsertJourneyPregnancyRow(
      tx as never,
      'p1',
      JOURNEY,
      { outcome: 'ONGOING' },
      PROFILE,
    );

    const data = dataArg(update);
    expect('allergies' in data).toBe(false); // collection not in the patch
    const rows = pregnancies(update);
    expect(rows.find((r) => r.id === 'r1')).toMatchObject({
      outcome: 'MISCARRIAGE',
      notes: 'keep me',
    });
    expect(rows).toHaveLength(2);
  });
});

describe('ObgynHistoryService.upsertJourneyGynSurgeryRow (surgical history sync)', () => {
  const JOURNEY = 'journey-SURG';

  function surgeries(update: jest.Mock): Array<Record<string, unknown>> {
    return dataArg(update).gyn_surgeries as Array<Record<string, unknown>>;
  }

  it('appends a PLANNED row tagged with the journey — without touching the obstetric summary', async () => {
    const { service, eventBus } = makeService();
    const { tx, update } = createTx(baseSingleton());

    await service.upsertJourneyGynSurgeryRow(
      tx as never,
      'p1',
      JOURNEY,
      {
        outcome: 'PLANNED',
        procedure_code: 'MYOMECTOMY',
        procedure_name: 'Myomectomy',
        surgery_date: '2026-08-01',
      },
      PROFILE,
    );

    const rows = surgeries(update);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: 'PLANNED',
      procedure_code: 'MYOMECTOMY',
      journey_id: JOURNEY,
      created_by_id: PROFILE,
    });
    // gyn_surgeries never trigger the GTPAL recompute.
    expect('obstetric_summary' in dataArg(update)).toBe(false);
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('adopts the most recent untagged still-planned row with the same procedure code', async () => {
    const { service } = makeService();
    const { tx, update } = createTx(
      baseSingleton({
        gyn_surgeries: [
          {
            id: 's-old',
            outcome: 'PLANNED',
            procedure_code: 'MYOMECTOMY',
            created_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 's-new',
            procedure_code: 'MYOMECTOMY', // no outcome → still planned
            created_at: '2026-06-01T00:00:00Z',
          },
          { id: 's-done', outcome: 'COMPLETED', procedure_code: 'MYOMECTOMY' },
        ],
      }),
    );

    await service.upsertJourneyGynSurgeryRow(
      tx as never,
      'p1',
      JOURNEY,
      { outcome: 'PLANNED', procedure_code: 'MYOMECTOMY' },
      PROFILE,
    );

    const rows = surgeries(update);
    expect(rows).toHaveLength(3); // adopted, not appended
    expect(rows.find((r) => r.id === 's-new')).toMatchObject({
      journey_id: JOURNEY,
    });
    expect(rows.find((r) => r.id === 's-old')?.journey_id).toBeUndefined();
    expect(rows.find((r) => r.id === 's-done')?.journey_id).toBeUndefined();
  });

  it('appends instead of adopting when the procedure code differs or is absent', async () => {
    const { service } = makeService();
    const { tx, update } = createTx(
      baseSingleton({
        gyn_surgeries: [
          { id: 's1', outcome: 'PLANNED', procedure_code: 'HYSTERECTOMY' },
        ],
      }),
    );

    await service.upsertJourneyGynSurgeryRow(
      tx as never,
      'p1',
      JOURNEY,
      { outcome: 'PLANNED', procedure_code: 'MYOMECTOMY' },
      PROFILE,
    );

    const rows = surgeries(update);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      procedure_code: 'MYOMECTOMY',
      journey_id: JOURNEY,
    });
    expect(rows[0].journey_id).toBeUndefined();
  });

  it('finalizes the journey-tagged row on close', async () => {
    const { service } = makeService();
    const { tx, update } = createTx(
      baseSingleton({
        gyn_surgeries: [
          {
            id: 's1',
            outcome: 'PLANNED',
            procedure_code: 'CESAREAN_SECTION',
            journey_id: JOURNEY,
          },
        ],
      }),
    );

    await service.upsertJourneyGynSurgeryRow(
      tx as never,
      'p1',
      JOURNEY,
      {
        outcome: 'COMPLETED',
        procedure_code: 'CESAREAN_SECTION',
        surgery_date: '2026-07-16',
        complications: 'None',
      },
      PROFILE,
    );

    const rows = surgeries(update);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 's1',
      outcome: 'COMPLETED',
      surgery_date: '2026-07-16',
      complications: 'None',
      journey_id: JOURNEY,
    });
  });

  it('is idempotent: an in-sync target writes nothing', async () => {
    const { service, eventBus } = makeService();
    const { tx, update } = createTx(
      baseSingleton({
        gyn_surgeries: [{ id: 's1', outcome: 'PLANNED', journey_id: JOURNEY }],
      }),
    );

    await service.upsertJourneyGynSurgeryRow(
      tx as never,
      'p1',
      JOURNEY,
      { outcome: 'PLANNED' },
      PROFILE,
    );

    expect(update).not.toHaveBeenCalled();
    expect(tx.patientObgynHistoryRevision.create).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('leaves other collections (incl. pregnancies) untouched', async () => {
    const { service } = makeService();
    const { tx, update } = createTx(
      baseSingleton({
        pregnancies: [{ id: 'r1', outcome: 'ONGOING' }],
        gyn_surgeries: [{ id: 's1', outcome: 'COMPLETED', notes: 'keep me' }],
      }),
    );

    await service.upsertJourneyGynSurgeryRow(
      tx as never,
      'p1',
      JOURNEY,
      { outcome: 'PLANNED', procedure_code: 'MYOMECTOMY' },
      PROFILE,
    );

    const data = dataArg(update);
    expect('pregnancies' in data).toBe(false);
    const rows = surgeries(update);
    expect(rows.find((r) => r.id === 's1')).toMatchObject({
      outcome: 'COMPLETED',
      notes: 'keep me',
    });
    expect(rows).toHaveLength(2);
  });
});
