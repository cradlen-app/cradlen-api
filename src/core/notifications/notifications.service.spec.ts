import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { PushService } from './push.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let pushService: { sendToProfile: jest.Mock };

  const buildRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'notif-1',
    profile_id: 'profile-1',
    code: 'invitation.accepted',
    category: 'staff',
    title: 'Invitation Accepted',
    description: 'Sara accepted your invitation.',
    navigate_to: '/org-1/branch-1/dashboard/staff/invitations/inv-1',
    is_read: false,
    read_at: null,
    metadata: { invitationId: 'inv-1' },
    is_deleted: false,
    deleted_at: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });

  beforeEach(async () => {
    db = {
      notification: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    pushService = { sendToProfile: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: { db } },
        { provide: PushService, useValue: pushService },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  describe('create', () => {
    it('persists the notification and fans it out to the profile push devices', async () => {
      db.notification.create.mockResolvedValueOnce(buildRow({ id: 'notif-7' }));

      await service.create({
        profileId: 'profile-1',
        code: 'invitation.accepted',
        category: 'staff',
        title: 'Invitation Accepted',
        description: 'Sara accepted your invitation.',
        navigateTo: '/org-1/branch-1/dashboard/staff/invitations/inv-1',
      });

      // The created notification id is the de-dupe tag so messages don't collapse.
      expect(pushService.sendToProfile).toHaveBeenCalledWith('profile-1', {
        title: 'Invitation Accepted',
        body: 'Sara accepted your invitation.',
        navigate_to: '/org-1/branch-1/dashboard/staff/invitations/inv-1',
        tag: 'notif-7',
      });
    });
  });

  describe('list', () => {
    it('paginates, maps rows to the public shape, and attaches unreadCount', async () => {
      db.notification.findMany.mockResolvedValueOnce([buildRow()]);
      db.notification.count
        .mockResolvedValueOnce(1) // total
        .mockResolvedValueOnce(3); // unreadCount

      const result = await service.list('profile-1', 1, 20);

      // Mapper strips internal columns.
      expect(result.items[0]).toEqual({
        id: 'notif-1',
        category: 'staff',
        title: 'Invitation Accepted',
        description: 'Sara accepted your invitation.',
        navigate_to: '/org-1/branch-1/dashboard/staff/invitations/inv-1',
        is_read: false,
        read_at: null,
        metadata: { invitationId: 'inv-1' },
        created_at: new Date('2026-01-01T00:00:00Z'),
      });
      expect(result.items[0]).not.toHaveProperty('profile_id');
      expect(result.items[0]).not.toHaveProperty('code');
      expect(result.items[0]).not.toHaveProperty('is_deleted');

      expect(result.meta).toMatchObject({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
        unreadCount: 3,
      });
    });

    it('scopes every query to the profile and filters by category when given', async () => {
      db.notification.findMany.mockResolvedValueOnce([]);
      db.notification.count.mockResolvedValue(0);

      await service.list('profile-9', 2, 10, 'appointment');

      expect(db.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            profile_id: 'profile-9',
            is_deleted: false,
            category: 'appointment',
          },
          skip: 10,
          take: 10,
        }),
      );
      expect(db.notification.count).toHaveBeenCalledWith({
        where: { profile_id: 'profile-9', is_deleted: false, is_read: false },
      });
    });
  });

  describe('markRead', () => {
    it('flips only unread rows and returns the mapped current state', async () => {
      db.notification.updateMany.mockResolvedValueOnce({ count: 1 });
      db.notification.findFirst.mockResolvedValueOnce(
        buildRow({ is_read: true, read_at: new Date('2026-01-02T00:00:00Z') }),
      );

      const result = await service.markRead('notif-1', 'profile-1');

      expect(db.notification.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'notif-1',
          profile_id: 'profile-1',
          is_deleted: false,
          is_read: false,
        },
        data: expect.objectContaining({ is_read: true }),
      });
      expect(result.is_read).toBe(true);
      expect(result).not.toHaveProperty('profile_id');
    });

    it('throws 404 when the notification does not belong to the profile', async () => {
      db.notification.updateMany.mockResolvedValueOnce({ count: 0 });
      db.notification.findFirst.mockResolvedValueOnce(null);

      await expect(service.markRead('notif-x', 'profile-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('is idempotent for an already-read row (no error, returns current state)', async () => {
      db.notification.updateMany.mockResolvedValueOnce({ count: 0 });
      db.notification.findFirst.mockResolvedValueOnce(
        buildRow({ is_read: true, read_at: new Date('2026-01-02T00:00:00Z') }),
      );

      const result = await service.markRead('notif-1', 'profile-1');
      expect(result.is_read).toBe(true);
    });
  });

  describe('markAllRead', () => {
    it("updates only the profile's unread, non-deleted rows", async () => {
      db.notification.updateMany.mockResolvedValueOnce({ count: 5 });

      await service.markAllRead('profile-1');

      expect(db.notification.updateMany).toHaveBeenCalledWith({
        where: { profile_id: 'profile-1', is_read: false, is_deleted: false },
        data: expect.objectContaining({ is_read: true }),
      });
    });
  });
});
