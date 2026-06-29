import { Prisma } from '@prisma/client';
import { AdminAuditService } from './admin-audit.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

const mockDb = {
  adminAuditLog: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
};
const mockPrisma = { db: mockDb } as unknown as PrismaService;

describe('AdminAuditService', () => {
  let service: AdminAuditService;

  beforeEach(() => {
    service = new AdminAuditService(mockPrisma);
  });

  describe('record', () => {
    it('writes through the supplied tx client when given one', async () => {
      const txCreate = jest.fn();
      const txClient = {
        adminAuditLog: { create: txCreate },
      } as unknown as Prisma.TransactionClient;

      await service.record(
        {
          adminId: 'a1',
          action: 'subscription.suspend',
          targetType: 'subscription',
          targetId: 's1',
          before: { status: 'ACTIVE' },
          after: { status: 'EXPIRED' },
        },
        txClient,
      );

      expect(txCreate).toHaveBeenCalledTimes(1);
      expect(mockDb.adminAuditLog.create).not.toHaveBeenCalled();
      expect(txCreate.mock.calls[0][0].data).toMatchObject({
        admin_id: 'a1',
        action: 'subscription.suspend',
        target_id: 's1',
        before: { status: 'ACTIVE' },
        after: { status: 'EXPIRED' },
      });
    });

    it('defaults missing before/after to Prisma.JsonNull on the base client', async () => {
      await service.record({
        adminId: 'a1',
        action: 'payment.verify',
        targetType: 'subscription_payment',
        targetId: 'p1',
      });

      const data = mockDb.adminAuditLog.create.mock.calls[0][0].data;
      expect(data.before).toBe(Prisma.JsonNull);
      expect(data.after).toBe(Prisma.JsonNull);
      expect(data.target_id).toBe('p1');
    });
  });

  describe('list', () => {
    it('maps rows and folds in the admin email', async () => {
      mockDb.adminAuditLog.findMany.mockResolvedValue([
        {
          id: 'l1',
          admin_id: 'a1',
          action: 'user.deactivate',
          target_type: 'user',
          target_id: 'u1',
          before: { is_active: true },
          after: { is_active: false },
          created_at: new Date('2026-06-25T00:00:00Z'),
          admin: { email: 'admin@cradlen.com' },
        },
      ]);
      mockDb.adminAuditLog.count.mockResolvedValue(1);

      const res = await service.list({ page: 1, limit: 20 });

      expect(res.meta.total).toBe(1);
      // `paginated()` returns { items, meta }; the ResponseInterceptor renames
      // `items` -> `data` at the HTTP layer, so at the service level it is `items`.
      expect(res.items[0]).toMatchObject({
        id: 'l1',
        admin_email: 'admin@cradlen.com',
        action: 'user.deactivate',
      });
    });
  });
});
