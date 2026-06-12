import { Test } from '@nestjs/testing';
import { OverdueVisitSweepService } from './overdue-visit-sweep.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { VisitStatusService } from '@core/clinical/visits/visit-status.service.js';

describe('OverdueVisitSweepService', () => {
  let service: OverdueVisitSweepService;
  let db: { visit: { findMany: jest.Mock } };
  let visitStatusServiceMock: { updateStatus: jest.Mock };

  beforeEach(async () => {
    db = { visit: { findMany: jest.fn().mockResolvedValue([]) } };
    visitStatusServiceMock = {
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        OverdueVisitSweepService,
        { provide: PrismaService, useValue: { db } },
        { provide: VisitStatusService, useValue: visitStatusServiceMock },
      ],
    }).compile();

    service = module.get(OverdueVisitSweepService);
  });

  it('calls updateStatus with NO_SHOW for each overdue visit using per-visit org context', async () => {
    db.visit.findMany.mockResolvedValue([
      { id: 'v1', episode: { journey: { organization_id: 'org-1' } } },
      { id: 'v2', episode: { journey: { organization_id: 'org-2' } } },
    ]);

    await service.sweepOverdueVisits();

    expect(visitStatusServiceMock.updateStatus).toHaveBeenCalledTimes(2);
    expect(visitStatusServiceMock.updateStatus).toHaveBeenCalledWith(
      'v1',
      { status: 'NO_SHOW' },
      expect.objectContaining({
        userId: 'system',
        profileId: 'system',
        organizationId: 'org-1',
      }),
    );
    expect(visitStatusServiceMock.updateStatus).toHaveBeenCalledWith(
      'v2',
      { status: 'NO_SHOW' },
      expect.objectContaining({
        userId: 'system',
        profileId: 'system',
        organizationId: 'org-2',
      }),
    );
  });

  it('queries with correct where clause', async () => {
    await service.sweepOverdueVisits();

    expect(db.visit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'SCHEDULED',
          checked_in_at: null,
          is_deleted: false,
          scheduled_at: { lt: expect.any(Date) },
        }),
      }),
    );
  });

  it('does nothing when no overdue visits found', async () => {
    db.visit.findMany.mockResolvedValue([]);

    await service.sweepOverdueVisits();

    expect(visitStatusServiceMock.updateStatus).not.toHaveBeenCalled();
  });

  it('continues processing remaining visits when one fails', async () => {
    db.visit.findMany.mockResolvedValue([
      { id: 'v1', episode: { journey: { organization_id: 'org-1' } } },
      { id: 'v2', episode: { journey: { organization_id: 'org-2' } } },
    ]);
    visitStatusServiceMock.updateStatus
      .mockRejectedValueOnce(new Error('visit locked'))
      .mockResolvedValueOnce(undefined);

    await service.sweepOverdueVisits();

    expect(visitStatusServiceMock.updateStatus).toHaveBeenCalledTimes(2);
    expect(visitStatusServiceMock.updateStatus).toHaveBeenCalledWith(
      'v2',
      { status: 'NO_SHOW' },
      expect.objectContaining({ organizationId: 'org-2' }),
    );
  });
});
