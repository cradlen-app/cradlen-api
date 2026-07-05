import { AdminsService } from './admins.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AdminVerificationService } from '../auth/admin-verification.service.js';
import { AdminAuditService } from '../audit/admin-audit.service.js';

const mockDb = {
  platformAdmin: {
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};
const mockPrisma = { db: mockDb } as unknown as PrismaService;
const mockVerification = {
  sendSetPasswordInvite: jest.fn(),
  revokeSetPasswordInvite: jest.fn(),
};
const mockAudit = { record: jest.fn() };

const row = (over: Record<string, unknown> = {}) => ({
  id: 'a2',
  email: 'ops@cradlen.com',
  full_name: 'Ops',
  is_active: true,
  password_hashed: 'h',
  created_at: new Date('2026-06-26T00:00:00Z'),
  ...over,
});

describe('AdminsService', () => {
  let service: AdminsService;

  beforeEach(() => {
    service = new AdminsService(
      mockPrisma,
      mockVerification as unknown as AdminVerificationService,
      mockAudit as unknown as AdminAuditService,
    );
  });

  describe('list', () => {
    it('derives status (ACTIVE / PENDING / DISABLED) and never leaks the hash', async () => {
      mockDb.platformAdmin.findMany.mockResolvedValue([
        row({ id: 'a1', password_hashed: 'h', is_active: true }),
        row({ id: 'a2', password_hashed: null, is_active: true }),
        row({ id: 'a3', password_hashed: 'h', is_active: false }),
      ]);
      mockDb.platformAdmin.count.mockResolvedValue(3);

      const res = await service.list({ page: 1, limit: 20 });
      const statuses = res.items.map((a) => a.status);
      expect(statuses).toEqual(['ACTIVE', 'PENDING', 'DISABLED']);
      expect(
        (res.items[0] as Record<string, unknown>).password_hashed,
      ).toBeUndefined();
    });
  });

  describe('create', () => {
    it('creates a passwordless admin (PENDING), sends an invite, and audits', async () => {
      mockDb.platformAdmin.create.mockResolvedValue(
        row({ id: 'new', password_hashed: null, is_active: true }),
      );

      const res = await service.create('actor-1', {
        email: 'ops@cradlen.com',
        full_name: 'Ops',
      });

      expect(mockVerification.sendSetPasswordInvite).toHaveBeenCalledWith(
        'new',
        'ops@cradlen.com',
      );
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId: 'actor-1',
          action: 'admin.create',
          targetId: 'new',
        }),
      );
      expect(res.status).toBe('PENDING');
    });

    it('revives a cancelled (soft-deleted) same-email invite instead of failing', async () => {
      mockDb.platformAdmin.findUnique.mockResolvedValue({
        id: 'old',
        is_deleted: true,
      });
      mockDb.platformAdmin.update.mockResolvedValue(
        row({ id: 'old', password_hashed: null, is_active: true }),
      );

      const res = await service.create('actor-1', {
        email: 'ops@cradlen.com',
        full_name: 'Ops',
      });

      expect(mockDb.platformAdmin.create).not.toHaveBeenCalled();
      expect(mockDb.platformAdmin.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'old' },
          data: expect.objectContaining({ is_deleted: false, deleted_at: null }),
        }),
      );
      expect(mockVerification.sendSetPasswordInvite).toHaveBeenCalledWith(
        'old',
        'ops@cradlen.com',
      );
      expect(res.status).toBe('PENDING');
    });
  });

  describe('cancelInvite', () => {
    it('rejects cancelling an admin who has set a password', async () => {
      mockDb.platformAdmin.findFirst.mockResolvedValue(
        row({ id: 'a2', password_hashed: 'h' }),
      );
      await expect(service.cancelInvite('a1', 'a2')).rejects.toMatchObject({
        status: 400,
      });
    });

    it('soft-deletes the pending admin, revokes the invite, and audits', async () => {
      mockDb.platformAdmin.findFirst.mockResolvedValue(
        row({ id: 'a2', password_hashed: null }),
      );
      mockDb.platformAdmin.update.mockResolvedValue(
        row({ id: 'a2', password_hashed: null }),
      );

      await service.cancelInvite('a1', 'a2');

      expect(mockDb.platformAdmin.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a2' },
          data: expect.objectContaining({ is_deleted: true }),
        }),
      );
      expect(mockVerification.revokeSetPasswordInvite).toHaveBeenCalledWith('a2');
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.invite_cancel' }),
      );
    });
  });

  describe('disable', () => {
    it('rejects disabling your own account', async () => {
      await expect(service.disable('a1', 'a1')).rejects.toMatchObject({
        status: 400,
      });
    });

    it('rejects disabling the last active admin', async () => {
      mockDb.platformAdmin.findFirst.mockResolvedValue(
        row({ id: 'a2', is_active: true }),
      );
      mockDb.platformAdmin.count.mockResolvedValue(1);
      await expect(service.disable('a1', 'a2')).rejects.toMatchObject({
        status: 400,
      });
    });

    it('disables another admin when others remain active and audits', async () => {
      mockDb.platformAdmin.findFirst.mockResolvedValue(
        row({ id: 'a2', is_active: true }),
      );
      mockDb.platformAdmin.count.mockResolvedValue(2);
      mockDb.platformAdmin.update.mockResolvedValue(
        row({ id: 'a2', is_active: false }),
      );

      const res = await service.disable('a1', 'a2');
      expect(mockDb.platformAdmin.update).toHaveBeenCalledWith({
        where: { id: 'a2' },
        data: { is_active: false },
        select: expect.any(Object),
      });
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.disable' }),
      );
      expect(res.status).toBe('DISABLED');
    });
  });

  describe('resendInvite', () => {
    it('rejects when the admin already has a password', async () => {
      mockDb.platformAdmin.findFirst.mockResolvedValue(
        row({ id: 'a2', password_hashed: 'h' }),
      );
      await expect(service.resendInvite('a1', 'a2')).rejects.toMatchObject({
        status: 400,
      });
    });

    it('re-sends the invite for a pending admin', async () => {
      mockDb.platformAdmin.findFirst.mockResolvedValue(
        row({ id: 'a2', password_hashed: null }),
      );
      await service.resendInvite('a1', 'a2');
      expect(mockVerification.sendSetPasswordInvite).toHaveBeenCalledWith(
        'a2',
        'ops@cradlen.com',
      );
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.invite_resend' }),
      );
    });
  });
});
