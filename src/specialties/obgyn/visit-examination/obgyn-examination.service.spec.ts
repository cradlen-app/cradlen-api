import { BadRequestException } from '@nestjs/common';
import { ObgynExaminationService } from './obgyn-examination.service';
import { CLINICAL_EVENTS } from '@core/clinical/events/events.public';
import type { UpdateObgynExaminationDto } from './dto/obgyn-examination.dto';

/**
 * Focused spec for the in-visit care-path write path: when the doctor sets
 * `case_path` on the Examination tab, the active journey's `care_path_id`
 * (single source of truth) is updated and a `journey.care_path.set` event fires.
 */

const USER = {
  userId: 'u1',
  profileId: 'profile-1',
  organizationId: 'org-1',
  roles: ['STAFF'],
  branchIds: ['branch-1'],
} as never;

/** Mock tx client exposing only what `patch` touches for a case_path-only dto. */
function createTx(opts: {
  currentCarePathCode: string | null;
  resolvedCarePathId: string | null;
}) {
  const journey = {
    id: 'journey-1',
    patient_id: 'patient-1',
    care_path: opts.currentCarePathCode
      ? { code: opts.currentCarePathCode }
      : null,
  };
  const tx = {
    visit: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'visit-1',
        specialty_code: 'OBGYN',
        episode: { journey },
      }),
      update: jest.fn().mockResolvedValue({ examination_version: 2 }),
    },
    visitEncounter: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
    visitEncounterRevision: { create: jest.fn() },
    carePath: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          opts.resolvedCarePathId ? { id: opts.resolvedCarePathId } : null,
        ),
    },
    patientJourney: { update: jest.fn() },
    // Pregnancy care-path switch guard: no active pregnancy in these fixtures.
    pregnancyJourneyRecord: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  return tx;
}

function makeService(tx: ReturnType<typeof createTx>) {
  const eventBus = { publish: jest.fn() };
  const prismaService = {
    db: {
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (t: unknown) => unknown)(tx)
          : Promise.resolve([]),
      ),
    },
  };
  const access = { assertVisitInOrg: jest.fn().mockResolvedValue(undefined) };
  const service = new ObgynExaminationService(
    prismaService as never,
    access as never,
    eventBus as never,
    {} as never, // ObgynHistoryService — unused for a case_path-only patch
  );
  // The PATCH returns composeEnvelope(); stub it so the test stays scoped to
  // the write path (the read path has its own surface).
  jest
    .spyOn(service as never, 'composeEnvelope')
    .mockResolvedValue({} as never);
  return { service, eventBus };
}

describe('ObgynExaminationService — in-visit care path → journey', () => {
  it('updates the journey care_path and emits journey.care_path.set', async () => {
    const tx = createTx({
      currentCarePathCode: 'OBGYN_GENERAL',
      resolvedCarePathId: 'cp-surgery',
    });
    const { service, eventBus } = makeService(tx);

    await service.patch(
      'visit-1',
      { case_path: 'OBGYN_SURGERY' } as UpdateObgynExaminationDto,
      USER,
    );

    expect(tx.patientJourney.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'journey-1' },
        data: { care_path_id: 'cp-surgery' },
      }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      CLINICAL_EVENTS.journey.carePathSet,
      expect.objectContaining({
        journey_id: 'journey-1',
        previous_care_path_code: 'OBGYN_GENERAL',
        new_care_path_code: 'OBGYN_SURGERY',
      }),
    );
  });

  it('never flips a journey to pregnancy via the examination (activation-only)', async () => {
    const tx = createTx({
      currentCarePathCode: 'OBGYN_GENERAL',
      resolvedCarePathId: 'cp-pregnancy',
    });
    const { service, eventBus } = makeService(tx);

    await service.patch(
      'visit-1',
      { case_path: 'OBGYN_PREGNANCY' } as UpdateObgynExaminationDto,
      USER,
    );

    // Pregnancy is owned by the activation flow — the examination is a no-op.
    expect(tx.patientJourney.update).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalledWith(
      CLINICAL_EVENTS.journey.carePathSet,
      expect.anything(),
    );
  });

  it('is a no-op when the journey already follows the chosen care path', async () => {
    const tx = createTx({
      currentCarePathCode: 'OBGYN_PREGNANCY',
      resolvedCarePathId: 'cp-pregnancy',
    });
    const { service, eventBus } = makeService(tx);

    await service.patch(
      'visit-1',
      { case_path: 'OBGYN_PREGNANCY' } as UpdateObgynExaminationDto,
      USER,
    );

    expect(tx.patientJourney.update).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalledWith(
      CLINICAL_EVENTS.journey.carePathSet,
      expect.anything(),
    );
  });

  it('rejects an unknown care path with 400', async () => {
    const tx = createTx({
      currentCarePathCode: 'OBGYN_GENERAL',
      resolvedCarePathId: null, // carePath.findFirst → null
    });
    const { service } = makeService(tx);

    await expect(
      service.patch(
        'visit-1',
        { case_path: 'NOPE' } as UpdateObgynExaminationDto,
        USER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.patientJourney.update).not.toHaveBeenCalled();
  });
});
