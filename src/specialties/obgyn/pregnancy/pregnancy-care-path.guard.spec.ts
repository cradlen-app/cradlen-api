import { ConflictException } from '@nestjs/common';
import { assertCarePathChangeAllowed } from './pregnancy-care-path.guard';

function txWith(activePregnancy: boolean) {
  return {
    pregnancyJourneyRecord: {
      findFirst: jest
        .fn()
        .mockResolvedValue(activePregnancy ? { id: 'preg-1' } : null),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('assertCarePathChangeAllowed', () => {
  it('is a no-op when re-selecting OBGYN_PREGNANCY (idempotent)', async () => {
    const tx = txWith(true);
    await expect(
      assertCarePathChangeAllowed(tx, 'journey-1', 'OBGYN_PREGNANCY'),
    ).resolves.toBeUndefined();
    // Never even queries — pregnancy → pregnancy is always allowed.
    expect(tx.pregnancyJourneyRecord.findFirst).not.toHaveBeenCalled();
  });

  it('allows reclassifying a provisional journey with no active pregnancy', async () => {
    const tx = txWith(false);
    await expect(
      assertCarePathChangeAllowed(tx, 'journey-1', 'OBGYN_SURGICAL'),
    ).resolves.toBeUndefined();
    expect(tx.pregnancyJourneyRecord.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          journey_id: 'journey-1',
          status: 'ACTIVE',
          is_deleted: false,
        }),
      }),
    );
  });

  it('blocks switching away from an active pregnancy with 409 PREGNANCY_ACTIVE', async () => {
    const tx = txWith(true);
    await expect(
      assertCarePathChangeAllowed(tx, 'journey-1', 'OBGYN_GENERAL'),
    ).rejects.toBeInstanceOf(ConflictException);

    try {
      await assertCarePathChangeAllowed(tx, 'journey-1', 'OBGYN_GENERAL');
    } catch (err) {
      const response = (err as ConflictException).getResponse() as {
        code: string;
      };
      expect(response.code).toBe('PREGNANCY_ACTIVE');
    }
  });
});
