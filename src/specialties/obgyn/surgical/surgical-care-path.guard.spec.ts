import { ConflictException } from '@nestjs/common';
import { assertSurgicalCarePathChangeAllowed } from './surgical-care-path.guard';

function txWith(activeSurgical: boolean) {
  return {
    surgicalJourneyRecord: {
      findFirst: jest
        .fn()
        .mockResolvedValue(activeSurgical ? { id: 'surg-1' } : null),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('assertSurgicalCarePathChangeAllowed', () => {
  it('is a no-op when re-selecting OBGYN_SURGICAL (idempotent)', async () => {
    const tx = txWith(true);
    await expect(
      assertSurgicalCarePathChangeAllowed(tx, 'journey-1', 'OBGYN_SURGICAL'),
    ).resolves.toBeUndefined();
    expect(tx.surgicalJourneyRecord.findFirst).not.toHaveBeenCalled();
  });

  it('allows reclassifying a journey with no active surgical profile', async () => {
    const tx = txWith(false);
    await expect(
      assertSurgicalCarePathChangeAllowed(tx, 'journey-1', 'OBGYN_GENERAL'),
    ).resolves.toBeUndefined();
  });

  it('blocks switching away from an active surgical journey with 409 SURGICAL_ACTIVE', async () => {
    const tx = txWith(true);
    try {
      await assertSurgicalCarePathChangeAllowed(
        tx,
        'journey-1',
        'OBGYN_GENERAL',
      );
      fail('expected a ConflictException');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      const response = (err as ConflictException).getResponse() as {
        code: string;
      };
      expect(response.code).toBe('SURGICAL_ACTIVE');
    }
  });
});
