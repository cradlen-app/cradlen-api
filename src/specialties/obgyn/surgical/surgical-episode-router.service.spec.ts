import { SurgicalEpisodeRouterService } from './surgical-episode-router.service';

describe('SurgicalEpisodeRouterService', () => {
  const service = new SurgicalEpisodeRouterService();

  describe('resolveEpisodeOrder', () => {
    const surgery = new Date('2026-06-15T00:00:00.000Z');

    it('routes a visit before the surgery date to Pre-op (1)', () => {
      expect(
        service.resolveEpisodeOrder(surgery, new Date('2026-06-10T09:00:00Z')),
      ).toBe(1);
    });

    it('routes a visit on the surgery date to Surgery (2)', () => {
      expect(
        service.resolveEpisodeOrder(surgery, new Date('2026-06-15T14:00:00Z')),
      ).toBe(2);
    });

    it('routes a visit after the surgery date to Post-op (3)', () => {
      expect(
        service.resolveEpisodeOrder(surgery, new Date('2026-06-20T08:00:00Z')),
      ).toBe(3);
    });

    it('returns null when there is no surgery date yet', () => {
      expect(
        service.resolveEpisodeOrder(null, new Date('2026-06-20T08:00:00Z')),
      ).toBeNull();
    });
  });

  describe('routeVisitToEpisode', () => {
    function makeTx(target: unknown) {
      return {
        patientEpisode: {
          findFirst: jest.fn().mockResolvedValue(target),
          update: jest.fn(),
          updateMany: jest.fn(),
        },
        visit: { update: jest.fn() },
      };
    }

    it('re-points the visit, activates the target, and completes earlier phases', async () => {
      const tx = makeTx({ id: 'ep-3', order: 3, status: 'PENDING' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await service.routeVisitToEpisode(tx as any, 'journey-1', 'visit-1', 3);

      expect(tx.visit.update).toHaveBeenCalledWith({
        where: { id: 'visit-1' },
        data: { episode_id: 'ep-3' },
      });
      expect(tx.patientEpisode.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ep-3' } }),
      );
      expect(tx.patientEpisode.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            journey_id: 'journey-1',
            order: { lt: 3 },
          }),
        }),
      );
    });

    it('is a no-op when the target episode is missing', async () => {
      const tx = makeTx(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await service.routeVisitToEpisode(tx as any, 'journey-1', 'visit-1', 2);
      expect(tx.visit.update).not.toHaveBeenCalled();
    });
  });
});
