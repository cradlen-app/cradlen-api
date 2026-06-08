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
