import { PregnancyEpisodeRouterService } from './pregnancy-episode-router.service';

describe('PregnancyEpisodeRouterService', () => {
  const service = new PregnancyEpisodeRouterService();

  describe('resolveTrimesterOrder', () => {
    const asOf = new Date('2026-06-01T00:00:00.000Z');

    it('uses LMP when there is no US dating (20w → T2)', () => {
      const order = service.resolveTrimesterOrder(
        {
          lmp: new Date('2026-01-12T00:00:00.000Z'), // 140 days = 20w0d before asOf
          us_dating_date: null,
          us_ga_weeks: null,
          us_ga_days: null,
        },
        asOf,
      );
      expect(order).toBe(2);
    });

    it('prefers US dating over LMP when present (US says ~31w → T3)', () => {
      const order = service.resolveTrimesterOrder(
        {
          lmp: new Date('2026-04-01T00:00:00.000Z'), // LMP alone would be ~8w (T1)
          us_dating_date: new Date('2026-05-01T00:00:00.000Z'),
          us_ga_weeks: 30,
          us_ga_days: 0, // +31 days to asOf → ~34w → T3
        },
        asOf,
      );
      expect(order).toBe(3);
    });

    it('returns null with no usable dating', () => {
      expect(
        service.resolveTrimesterOrder(
          {
            lmp: null,
            us_dating_date: null,
            us_ga_weeks: null,
            us_ga_days: null,
          },
          asOf,
        ),
      ).toBeNull();
    });
  });

  describe('routeVisitToTrimester', () => {
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

    it('re-points the visit, activates the target, and completes earlier trimesters', async () => {
      const tx = makeTx({
        id: 'ep-2',
        order: 2,
        status: 'PENDING',
        started_at: null,
      });
      await service.routeVisitToTrimester(
        tx as never,
        'journey-1',
        'visit-1',
        2,
      );

      expect(tx.visit.update).toHaveBeenCalledWith({
        where: { id: 'visit-1' },
        data: { episode_id: 'ep-2' },
      });
      expect(tx.patientEpisode.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ep-2' },
          data: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      );
      expect(tx.patientEpisode.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            journey_id: 'journey-1',
            order: { lt: 2 },
          }),
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
    });

    it('does not re-activate an already-ACTIVE target', async () => {
      const tx = makeTx({
        id: 'ep-1',
        order: 1,
        status: 'ACTIVE',
        started_at: new Date(),
      });
      await service.routeVisitToTrimester(
        tx as never,
        'journey-1',
        'visit-1',
        1,
      );
      expect(tx.visit.update).toHaveBeenCalled();
      expect(tx.patientEpisode.update).not.toHaveBeenCalled();
    });

    it('is a no-op when the trimester episode is missing', async () => {
      const tx = makeTx(null);
      await service.routeVisitToTrimester(
        tx as never,
        'journey-1',
        'visit-1',
        2,
      );
      expect(tx.visit.update).not.toHaveBeenCalled();
      expect(tx.patientEpisode.update).not.toHaveBeenCalled();
      expect(tx.patientEpisode.updateMany).not.toHaveBeenCalled();
    });
  });
});
