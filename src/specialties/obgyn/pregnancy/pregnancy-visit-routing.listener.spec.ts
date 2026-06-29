import { PregnancyVisitRoutingListener } from './pregnancy-visit-routing.listener';
import { PregnancyEpisodeRouterService } from './pregnancy-episode-router.service';

describe('PregnancyVisitRoutingListener', () => {
  let listener: PregnancyVisitRoutingListener;
  let db: {
    pregnancyJourneyRecord: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let router: {
    resolveTrimesterOrder: jest.Mock;
    routeVisitToTrimester: jest.Mock;
  };

  beforeEach(() => {
    db = {
      pregnancyJourneyRecord: { findUnique: jest.fn() },
      $transaction: jest.fn().mockImplementation((cb) => cb('TX')),
    };
    router = {
      resolveTrimesterOrder: jest.fn(),
      routeVisitToTrimester: jest.fn().mockResolvedValue(undefined),
    };
    listener = new PregnancyVisitRoutingListener(
      { db } as never,
      router as unknown as PregnancyEpisodeRouterService,
    );
  });

  const event = (overrides = {}) => ({
    payload: {
      visit: { id: 'visit-1', scheduled_at: new Date('2026-06-01') },
      journey: { id: 'journey-1' },
      ...overrides,
    },
  });

  it('routes the visit to the resolved trimester for an ACTIVE pregnancy journey', async () => {
    db.pregnancyJourneyRecord.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      is_deleted: false,
      lmp: new Date('2026-01-12'),
      us_dating_date: null,
      us_ga_weeks: null,
      us_ga_days: null,
    });
    router.resolveTrimesterOrder.mockReturnValue(2);

    await listener.onVisitBooked(event());

    expect(router.routeVisitToTrimester).toHaveBeenCalledWith(
      'TX',
      'journey-1',
      'visit-1',
      2,
    );
  });

  it('ignores a non-pregnancy journey (no record)', async () => {
    db.pregnancyJourneyRecord.findUnique.mockResolvedValue(null);
    await listener.onVisitBooked(event());
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(router.routeVisitToTrimester).not.toHaveBeenCalled();
  });

  it('leaves the visit in place when there is no usable dating (order null)', async () => {
    db.pregnancyJourneyRecord.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      is_deleted: false,
      lmp: null,
      us_dating_date: null,
      us_ga_weeks: null,
      us_ga_days: null,
    });
    router.resolveTrimesterOrder.mockReturnValue(null);

    await listener.onVisitBooked(event());
    expect(router.routeVisitToTrimester).not.toHaveBeenCalled();
  });

  it('no-ops on a malformed event', async () => {
    await listener.onVisitBooked({ payload: { journey: {} } } as never);
    expect(db.pregnancyJourneyRecord.findUnique).not.toHaveBeenCalled();
  });
});
