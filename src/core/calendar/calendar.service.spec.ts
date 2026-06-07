import { BadRequestException } from '@nestjs/common';
import { CalendarEventType, CalendarVisibility } from '@prisma/client';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { CalendarService } from './calendar.service';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    profile_id: 'profile-1',
    organization_id: 'org-1',
    branch_id: null,
    event_type: CalendarEventType.DAY_OFF,
    visibility: CalendarVisibility.ORGANIZATION,
    title: 'Off',
    description: null,
    start_at: new Date('2026-06-10T08:00:00Z'),
    end_at: new Date('2026-06-10T09:00:00Z'),
    all_day: false,
    procedure_id: null,
    patient_id: null,
    procedure: null,
    patient: null,
    assistants: [],
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makeUser(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'user-1',
    profileId: 'profile-1',
    organizationId: 'org-1',
    activeBranchId: 'branch-a',
    roles: ['STAFF'],
    branchIds: ['branch-a'],
    ...overrides,
  };
}

describe('CalendarService', () => {
  let service: CalendarService;
  let db: {
    calendarEvent: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    branch: { findFirst: jest.Mock };
  };
  let assertCanAccessBranch: jest.Mock;

  beforeEach(() => {
    db = {
      calendarEvent: {
        create: jest.fn().mockResolvedValue(makeRow()),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-x' }) },
    };
    assertCanAccessBranch = jest.fn().mockResolvedValue(undefined);

    service = new CalendarService(
      { db } as never,
      { publish: jest.fn() } as never,
      { assertCanAccessBranch } as never,
    );
  });

  const baseDto = {
    event_type: CalendarEventType.DAY_OFF,
    title: 'Off',
    start_at: '2026-06-10T08:00:00Z',
    end_at: '2026-06-10T09:00:00Z',
  };

  describe('create — branch resolution', () => {
    it('non-owner ORGANIZATION event with no branch defaults to the active branch', async () => {
      await service.create(makeUser(), { ...baseDto } as never);
      expect(assertCanAccessBranch).not.toHaveBeenCalled();
      expect(db.calendarEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ branch_id: 'branch-a' }),
        }),
      );
    });

    it('BRANCH_MANAGER cannot create org-wide; defaults to active branch', async () => {
      await service.create(makeUser({ roles: ['BRANCH_MANAGER'] }), {
        ...baseDto,
      } as never);
      expect(db.calendarEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ branch_id: 'branch-a' }),
        }),
      );
    });

    it('OWNER with no branch + ORGANIZATION creates an org-wide (null) event', async () => {
      await service.create(makeUser({ roles: ['OWNER'] }), {
        ...baseDto,
      } as never);
      expect(db.calendarEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ branch_id: null }),
        }),
      );
    });

    it('explicit branch is access-checked and stamped', async () => {
      await service.create(makeUser(), {
        ...baseDto,
        branch_id: 'branch-x',
      } as never);
      expect(assertCanAccessBranch).toHaveBeenCalledWith(
        'profile-1',
        'org-1',
        'branch-x',
      );
      expect(db.calendarEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ branch_id: 'branch-x' }),
        }),
      );
    });

    it('PRIVATE event with no branch is personal/untagged (null)', async () => {
      await service.create(makeUser(), {
        ...baseDto,
        event_type: CalendarEventType.MEETING,
        visibility: CalendarVisibility.PRIVATE,
      } as never);
      expect(db.calendarEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ branch_id: null }),
        }),
      );
    });

    it('non-owner with no active branch and no branch_id is rejected', async () => {
      await expect(
        service.create(makeUser({ activeBranchId: undefined }), {
          ...baseDto,
        } as never),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('list — branch-scoped visibility', () => {
    it('scopes to the active branch + null, plus own', async () => {
      await service.list(makeUser(), {
        from: '2026-06-01T00:00:00Z',
        to: '2026-06-30T00:00:00Z',
        branch_id: 'branch-a',
      } as never);

      const where = db.calendarEvent.findMany.mock.calls[0][0].where;
      const clause = where.AND[0];
      expect(clause.OR).toHaveLength(2);
      // own events, scoped to [branch-a, null]
      expect(clause.OR[0]).toMatchObject({ profile_id: 'profile-1' });
      expect(clause.OR[0].OR).toEqual([
        { branch_id: 'branch-a' },
        { branch_id: null },
      ]);
      // org-visible shared events at the branch + org-wide
      expect(clause.OR[1]).toMatchObject({
        visibility: CalendarVisibility.ORGANIZATION,
      });
      expect(clause.OR[1].OR).toEqual([
        { branch_id: 'branch-a' },
        { branch_id: null },
      ]);
      // no global branch_id filter remains
      expect(where.branch_id).toBeUndefined();
    });
  });
});
