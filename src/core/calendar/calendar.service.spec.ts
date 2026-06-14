import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CalendarEventType, CalendarVisibility } from '@prisma/client';
import { CalendarService } from './calendar.service';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { EventBus } from '@infrastructure/messaging/event-bus';
import { AuthorizationService } from '@core/auth/authorization/authorization.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { CALENDAR_EVENTS } from './calendar.events';

const mockUser: AuthContext = {
  userId: 'user-uuid',
  profileId: 'profile-uuid',
  organizationId: 'org-uuid',
  activeBranchId: 'branch-1',
  roles: ['OWNER'],
  branchIds: ['branch-1', 'branch-2'],
};

const mockEventRow = {
  id: 'event-uuid',
  profile_id: 'profile-uuid',
  organization_id: 'org-uuid',
  branch_id: null,
  event_type: CalendarEventType.MEETING,
  visibility: CalendarVisibility.PRIVATE,
  title: 'Hi',
  description: null,
  start_at: new Date('2026-06-01T10:00:00Z'),
  end_at: new Date('2026-06-01T11:00:00Z'),
  all_day: false,
  procedure_id: null,
  patient_id: null,
  procedure: null,
  patient: null,
  assistants: [],
  created_at: new Date(),
  updated_at: new Date(),
};

describe('CalendarService', () => {
  let service: CalendarService;
  let db: {
    calendarEvent: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    calendarEventAssistant: {
      deleteMany: jest.Mock;
      createMany: jest.Mock;
    };
    procedure: { findFirst: jest.Mock };
    patient: { findFirst: jest.Mock };
    profile: { findMany: jest.Mock };
    branch: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let eventBus: { publish: jest.Mock };
  let authorizationService: { assertCanAccessBranch: jest.Mock };

  beforeEach(async () => {
    db = {
      calendarEvent: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      calendarEventAssistant: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      procedure: { findFirst: jest.fn() },
      patient: { findFirst: jest.fn() },
      profile: { findMany: jest.fn() },
      branch: { findFirst: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        Promise.resolve(
          cb({
            calendarEvent: db.calendarEvent,
            calendarEventAssistant: db.calendarEventAssistant,
          }),
        ),
      ),
    };
    eventBus = { publish: jest.fn() };
    authorizationService = {
      assertCanAccessBranch: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarService,
        { provide: PrismaService, useValue: { db } },
        { provide: EventBus, useValue: eventBus },
        { provide: AuthorizationService, useValue: authorizationService },
      ],
    }).compile();
    service = module.get<CalendarService>(CalendarService);
  });

  describe('create — window validation', () => {
    it('rejects when end_at is not after start_at', async () => {
      await expect(
        service.create(mockUser, {
          event_type: CalendarEventType.MEETING,
          title: 'x',
          start_at: '2026-06-01T11:00:00Z',
          end_at: '2026-06-01T10:00:00Z',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(db.calendarEvent.create).not.toHaveBeenCalled();
    });

    it('rejects invalid ISO dates', async () => {
      await expect(
        service.create(mockUser, {
          event_type: CalendarEventType.MEETING,
          title: 'x',
          start_at: 'not-a-date',
          end_at: 'also-not-a-date',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('create — consistency rules', () => {
    it('requires procedure_id for PROCEDURE events', async () => {
      await expect(
        service.create(mockUser, {
          event_type: CalendarEventType.PROCEDURE,
          title: 'x',
          start_at: '2026-06-01T10:00:00Z',
          end_at: '2026-06-01T11:00:00Z',
        }),
      ).rejects.toThrow(/procedure_id is required/);
    });

    it('rejects procedure_id on non-PROCEDURE events', async () => {
      await expect(
        service.create(mockUser, {
          event_type: CalendarEventType.MEETING,
          title: 'x',
          start_at: '2026-06-01T10:00:00Z',
          end_at: '2026-06-01T11:00:00Z',
          procedure_id: 'proc-uuid',
        }),
      ).rejects.toThrow(/only valid for PROCEDURE/);
    });

    it('rejects patient_id on non-PROCEDURE events', async () => {
      await expect(
        service.create(mockUser, {
          event_type: CalendarEventType.DAY_OFF,
          title: 'x',
          start_at: '2026-06-01T10:00:00Z',
          end_at: '2026-06-01T11:00:00Z',
          patient_id: 'pat-uuid',
        }),
      ).rejects.toThrow(/patient_id is only valid/);
    });

    it('rejects assistant_profile_ids on non-PROCEDURE events', async () => {
      await expect(
        service.create(mockUser, {
          event_type: CalendarEventType.MEETING,
          title: 'x',
          start_at: '2026-06-01T10:00:00Z',
          end_at: '2026-06-01T11:00:00Z',
          assistant_profile_ids: ['assistant-uuid'],
        }),
      ).rejects.toThrow(/assistant_profile_ids is only valid/);
    });

    it('rejects self-assistant on PROCEDURE events', async () => {
      db.procedure.findFirst.mockResolvedValue({ id: 'proc-uuid' });
      await expect(
        service.create(mockUser, {
          event_type: CalendarEventType.PROCEDURE,
          title: 'x',
          start_at: '2026-06-01T10:00:00Z',
          end_at: '2026-06-01T11:00:00Z',
          procedure_id: 'proc-uuid',
          assistant_profile_ids: [mockUser.profileId],
        }),
      ).rejects.toThrow(/cannot list yourself/);
    });

    it('rejects unknown procedure_id', async () => {
      db.procedure.findFirst.mockResolvedValue(null);
      await expect(
        service.create(mockUser, {
          event_type: CalendarEventType.PROCEDURE,
          title: 'x',
          start_at: '2026-06-01T10:00:00Z',
          end_at: '2026-06-01T11:00:00Z',
          procedure_id: 'proc-uuid',
        }),
      ).rejects.toThrow(/does not reference an active procedure/);
    });

    it('rejects patient with no journey in this organization', async () => {
      db.procedure.findFirst.mockResolvedValue({ id: 'proc-uuid' });
      db.patient.findFirst.mockResolvedValue({ id: 'pat-uuid', journeys: [] });
      await expect(
        service.create(mockUser, {
          event_type: CalendarEventType.PROCEDURE,
          title: 'x',
          start_at: '2026-06-01T10:00:00Z',
          end_at: '2026-06-01T11:00:00Z',
          procedure_id: 'proc-uuid',
          patient_id: 'pat-uuid',
        }),
      ).rejects.toThrow(/not accessible to this organization/);
    });

    it('rejects branch_id the caller cannot access', async () => {
      authorizationService.assertCanAccessBranch.mockRejectedValueOnce(
        new ForbiddenException('Branch access denied'),
      );
      await expect(
        service.create(mockUser, {
          event_type: CalendarEventType.MEETING,
          title: 'x',
          start_at: '2026-06-01T10:00:00Z',
          end_at: '2026-06-01T11:00:00Z',
          branch_id: 'foreign-branch',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(authorizationService.assertCanAccessBranch).toHaveBeenCalledWith(
        mockUser.profileId,
        mockUser.organizationId,
        'foreign-branch',
      );
    });
  });

  describe('create — defaults & event publish', () => {
    it('defaults MEETING visibility to PRIVATE and publishes created event', async () => {
      db.branch.findFirst.mockResolvedValue({ id: 'branch-1' });
      db.calendarEvent.create.mockResolvedValue({
        ...mockEventRow,
        branch_id: 'branch-1',
      });

      await service.create(mockUser, {
        event_type: CalendarEventType.MEETING,
        title: 'standup',
        start_at: '2026-06-01T10:00:00Z',
        end_at: '2026-06-01T11:00:00Z',
        branch_id: 'branch-1',
      });

      expect(db.calendarEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            visibility: CalendarVisibility.PRIVATE,
            event_type: CalendarEventType.MEETING,
          }),
        }),
      );
      expect(eventBus.publish).toHaveBeenCalledWith(
        CALENDAR_EVENTS.event.created,
        expect.objectContaining({ id: mockEventRow.id }),
      );
    });

    it('defaults PROCEDURE visibility to ORGANIZATION', async () => {
      db.procedure.findFirst.mockResolvedValue({ id: 'proc-uuid' });
      db.calendarEvent.create.mockResolvedValue({
        ...mockEventRow,
        event_type: CalendarEventType.PROCEDURE,
        visibility: CalendarVisibility.ORGANIZATION,
        procedure_id: 'proc-uuid',
      });

      await service.create(mockUser, {
        event_type: CalendarEventType.PROCEDURE,
        title: 'op',
        start_at: '2026-06-01T10:00:00Z',
        end_at: '2026-06-01T11:00:00Z',
        procedure_id: 'proc-uuid',
      });

      expect(db.calendarEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            visibility: CalendarVisibility.ORGANIZATION,
          }),
        }),
      );
    });

    it('resolves created_by_name from the owner profile', async () => {
      db.branch.findFirst.mockResolvedValue({ id: 'branch-1' });
      db.calendarEvent.create.mockResolvedValue({
        ...mockEventRow,
        branch_id: 'branch-1',
        profile: { user: { first_name: 'Sara', last_name: 'Ali' } },
      });

      const result = await service.create(mockUser, {
        event_type: CalendarEventType.MEETING,
        title: 'standup',
        start_at: '2026-06-01T10:00:00Z',
        end_at: '2026-06-01T11:00:00Z',
        branch_id: 'branch-1',
      });

      expect(result.created_by_name).toBe('Sara Ali');
    });
  });

  describe('list', () => {
    it('rejects when "to" is not after "from"', async () => {
      await expect(
        service.list(mockUser, {
          from: '2026-06-02T00:00:00Z',
          to: '2026-06-01T00:00:00Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('scopes visibility to the active branch + org-wide, plus own', async () => {
      db.calendarEvent.findMany.mockResolvedValue([]);
      db.calendarEvent.count.mockResolvedValue(0);

      await service.list(mockUser, {
        from: '2026-06-01T00:00:00Z',
        to: '2026-06-30T00:00:00Z',
      });

      const args = db.calendarEvent.findMany.mock.calls[0][0];
      expect(args.where.organization_id).toBe(mockUser.organizationId);
      // Active branch comes from the caller's token (branch-1) — scope is the
      // active branch + null (org-wide), for own events and shared org events.
      const scope = [{ branch_id: 'branch-1' }, { branch_id: null }];
      expect(args.where.AND[0]).toEqual({
        OR: [
          { profile_id: mockUser.profileId, OR: scope },
          { visibility: CalendarVisibility.ORGANIZATION, OR: scope },
        ],
      });
      // No global branch_id filter remains (branch folded into the OR scope).
      expect(args.where.branch_id).toBeUndefined();
    });
  });

  describe('create — branch resolution', () => {
    const baseDto = {
      event_type: CalendarEventType.DAY_OFF,
      title: 'Off',
      start_at: '2026-06-10T08:00:00Z',
      end_at: '2026-06-10T09:00:00Z',
    };

    beforeEach(() => {
      db.calendarEvent.create.mockResolvedValue(mockEventRow);
    });

    it('non-owner ORGANIZATION event with no branch defaults to the active branch', async () => {
      await service.create({ ...mockUser, roles: ['STAFF'] }, {
        ...baseDto,
      } as never);
      expect(db.calendarEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ branch_id: 'branch-1' }),
        }),
      );
    });

    it('BRANCH_MANAGER cannot create org-wide; defaults to active branch', async () => {
      await service.create({ ...mockUser, roles: ['BRANCH_MANAGER'] }, {
        ...baseDto,
      } as never);
      expect(db.calendarEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ branch_id: 'branch-1' }),
        }),
      );
    });

    it('OWNER with no branch + ORGANIZATION creates an org-wide (null) event', async () => {
      await service.create(mockUser, { ...baseDto } as never);
      expect(db.calendarEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ branch_id: null }),
        }),
      );
    });

    it('explicit branch is access-checked and stamped', async () => {
      await service.create({ ...mockUser, roles: ['STAFF'] }, {
        ...baseDto,
        branch_id: 'branch-2',
      } as never);
      expect(authorizationService.assertCanAccessBranch).toHaveBeenCalledWith(
        'profile-uuid',
        'org-uuid',
        'branch-2',
      );
      expect(db.calendarEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ branch_id: 'branch-2' }),
        }),
      );
    });

    it('PRIVATE event with no branch is personal/untagged (null)', async () => {
      await service.create({ ...mockUser, roles: ['STAFF'] }, {
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
        service.create(
          { ...mockUser, roles: ['STAFF'], activeBranchId: undefined },
          { ...baseDto } as never,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update — branch re-gating', () => {
    beforeEach(() => {
      db.calendarEvent.findFirst.mockResolvedValue({
        ...mockEventRow,
        branch_id: 'branch-1',
      });
      db.calendarEvent.update.mockResolvedValue(mockEventRow);
    });

    it('OWNER may turn an owned event org-wide (null)', async () => {
      await service.update(mockUser, 'event-uuid', {
        branch_id: '',
        visibility: CalendarVisibility.ORGANIZATION,
      });
      expect(db.calendarEvent.update.mock.calls[0][0].data).toMatchObject({
        branch_id: null,
      });
    });

    it('non-owner editing their own event cannot go org-wide (stays on active branch)', async () => {
      await service.update({ ...mockUser, roles: ['STAFF'] }, 'event-uuid', {
        branch_id: '',
        visibility: CalendarVisibility.ORGANIZATION,
      });
      expect(db.calendarEvent.update.mock.calls[0][0].data).toMatchObject({
        branch_id: 'branch-1',
      });
    });

    it('moving an event to an explicit branch is access-checked', async () => {
      await service.update({ ...mockUser, roles: ['STAFF'] }, 'event-uuid', {
        branch_id: 'branch-2',
      });
      expect(authorizationService.assertCanAccessBranch).toHaveBeenCalledWith(
        'profile-uuid',
        'org-uuid',
        'branch-2',
      );
      expect(db.calendarEvent.update.mock.calls[0][0].data).toMatchObject({
        branch_id: 'branch-2',
      });
    });
  });

  describe('update', () => {
    it('throws NotFound when caller does not own the event', async () => {
      db.calendarEvent.findFirst.mockResolvedValue(null);
      await expect(
        service.update(mockUser, 'event-uuid', { title: 'new' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('drops assistants when type changes away from PROCEDURE', async () => {
      db.calendarEvent.findFirst.mockResolvedValue({
        ...mockEventRow,
        event_type: CalendarEventType.PROCEDURE,
        procedure_id: 'proc-uuid',
      });
      db.calendarEvent.update.mockResolvedValue(mockEventRow);

      await service.update(mockUser, 'event-uuid', {
        event_type: CalendarEventType.MEETING,
        procedure_id: null as unknown as string | undefined,
        patient_id: null as unknown as string | undefined,
      });

      expect(db.calendarEventAssistant.deleteMany).toHaveBeenCalledWith({
        where: { calendar_event_id: 'event-uuid' },
      });
    });

    it('replaces assistants when assistant_profile_ids is provided', async () => {
      db.calendarEvent.findFirst.mockResolvedValue({
        ...mockEventRow,
        event_type: CalendarEventType.PROCEDURE,
        procedure_id: 'proc-uuid',
      });
      db.procedure.findFirst.mockResolvedValue({ id: 'proc-uuid' });
      db.profile.findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);
      db.calendarEvent.update.mockResolvedValue(mockEventRow);

      await service.update(mockUser, 'event-uuid', {
        assistant_profile_ids: ['a1', 'a2'],
      });

      expect(db.calendarEventAssistant.deleteMany).toHaveBeenCalled();
      expect(db.calendarEventAssistant.createMany).toHaveBeenCalledWith({
        data: [
          { calendar_event_id: 'event-uuid', profile_id: 'a1' },
          { calendar_event_id: 'event-uuid', profile_id: 'a2' },
        ],
        skipDuplicates: true,
      });
    });

    it('publishes calendar.event.updated', async () => {
      db.calendarEvent.findFirst.mockResolvedValue(mockEventRow);
      db.calendarEvent.update.mockResolvedValue(mockEventRow);
      await service.update(mockUser, 'event-uuid', { title: 'renamed' });
      expect(eventBus.publish).toHaveBeenCalledWith(
        CALENDAR_EVENTS.event.updated,
        expect.objectContaining({ id: mockEventRow.id }),
      );
    });
  });

  describe('remove', () => {
    it('soft-deletes in a single query and publishes calendar.event.deleted', async () => {
      db.calendarEvent.update.mockResolvedValue({
        ...mockEventRow,
        is_deleted: true,
      });

      await service.remove(mockUser, 'event-uuid');

      expect(db.calendarEvent.findFirst).not.toHaveBeenCalled();
      expect(db.calendarEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'event-uuid',
            is_deleted: false,
            profile_id: mockUser.profileId,
            organization_id: mockUser.organizationId,
          },
          data: expect.objectContaining({ is_deleted: true }),
        }),
      );
      expect(eventBus.publish).toHaveBeenCalledWith(
        CALENDAR_EVENTS.event.deleted,
        expect.objectContaining({ id: mockEventRow.id }),
      );
    });

    it('propagates Prisma P2025 when the caller does not own the event', async () => {
      // Global filter maps P2025 → 404; here we just verify the call surfaces the error.
      const notFound = Object.assign(new Error('Record not found'), {
        code: 'P2025',
      });
      db.calendarEvent.update.mockRejectedValue(notFound);
      await expect(service.remove(mockUser, 'event-uuid')).rejects.toBe(
        notFound,
      );
      expect(eventBus.publish).not.toHaveBeenCalled();
    });
  });

  describe('PROCEDURE overlap guard', () => {
    const procDto = {
      event_type: CalendarEventType.PROCEDURE,
      title: 'op',
      start_at: '2026-06-01T10:00:00Z',
      end_at: '2026-06-01T12:00:00Z',
      procedure_id: 'proc-uuid',
    };

    it('create rejects when an existing PROCEDURE overlaps the window', async () => {
      db.procedure.findFirst.mockResolvedValue({ id: 'proc-uuid' });
      db.calendarEvent.findFirst.mockResolvedValue({
        id: 'other-event',
        start_at: new Date('2026-06-01T11:00:00Z'),
        end_at: new Date('2026-06-01T13:00:00Z'),
      });

      await expect(service.create(mockUser, procDto)).rejects.toThrow(
        ConflictException,
      );
      expect(db.calendarEvent.create).not.toHaveBeenCalled();
    });

    it('create allows contiguous (touching) windows', async () => {
      db.procedure.findFirst.mockResolvedValue({ id: 'proc-uuid' });
      db.calendarEvent.findFirst.mockResolvedValue(null);
      db.calendarEvent.create.mockResolvedValue({
        ...mockEventRow,
        event_type: CalendarEventType.PROCEDURE,
        procedure_id: 'proc-uuid',
      });

      await expect(service.create(mockUser, procDto)).resolves.toBeDefined();
      expect(db.calendarEvent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            profile_id: mockUser.profileId,
            event_type: CalendarEventType.PROCEDURE,
          }),
        }),
      );
    });

    it('create skips overlap check for non-PROCEDURE events', async () => {
      db.calendarEvent.create.mockResolvedValue(mockEventRow);
      await service.create(mockUser, {
        event_type: CalendarEventType.MEETING,
        title: 'standup',
        start_at: '2026-06-01T10:00:00Z',
        end_at: '2026-06-01T11:00:00Z',
      });
      // findFirst on calendarEvent is only called by the overlap guard;
      // for MEETING it must not be invoked.
      expect(db.calendarEvent.findFirst).not.toHaveBeenCalled();
    });

    it('update excludes the row being edited from the overlap check', async () => {
      db.calendarEvent.findFirst
        .mockResolvedValueOnce({
          ...mockEventRow,
          event_type: CalendarEventType.PROCEDURE,
          procedure_id: 'proc-uuid',
        })
        .mockResolvedValueOnce(null);
      db.procedure.findFirst.mockResolvedValue({ id: 'proc-uuid' });
      db.calendarEvent.update.mockResolvedValue(mockEventRow);

      await service.update(mockUser, 'event-uuid', {
        start_at: '2026-06-01T14:00:00Z',
        end_at: '2026-06-01T15:00:00Z',
      });

      const overlapCall = db.calendarEvent.findFirst.mock.calls[1][0];
      expect(overlapCall.where).toEqual(
        expect.objectContaining({
          id: { not: 'event-uuid' },
          event_type: CalendarEventType.PROCEDURE,
        }),
      );
    });

    it('update rejects when a different PROCEDURE overlaps the new window', async () => {
      db.calendarEvent.findFirst
        .mockResolvedValueOnce({
          ...mockEventRow,
          event_type: CalendarEventType.PROCEDURE,
          procedure_id: 'proc-uuid',
        })
        .mockResolvedValueOnce({
          id: 'other-event',
          start_at: new Date('2026-06-01T14:30:00Z'),
          end_at: new Date('2026-06-01T15:30:00Z'),
        });
      db.procedure.findFirst.mockResolvedValue({ id: 'proc-uuid' });

      await expect(
        service.update(mockUser, 'event-uuid', {
          start_at: '2026-06-01T14:00:00Z',
          end_at: '2026-06-01T15:00:00Z',
        }),
      ).rejects.toThrow(ConflictException);
      expect(db.calendarEvent.update).not.toHaveBeenCalled();
    });
  });
});
