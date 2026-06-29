import * as bcrypt from 'bcryptjs';
import { SubscriptionStatus, OrganizationStatus } from '@prisma/client';
import { AdminWriteService } from './admin-write.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { SubscriptionsService } from '@core/org/subscriptions/subscriptions.service.js';
import { SubscriptionPaymentsService } from '@core/org/subscriptions/payments/subscription-payments.service.js';
import { AdminAuditService } from '../audit/admin-audit.service.js';

jest.mock('bcryptjs');

const tx = {
  subscription: { update: jest.fn() },
  organization: { update: jest.fn() },
  user: { update: jest.fn() },
  refreshToken: { updateMany: jest.fn() },
};
const mockDb = {
  subscription: { findFirst: jest.fn() },
  subscriptionPlan: { findUnique: jest.fn() },
  organization: { findFirst: jest.fn() },
  user: { findFirst: jest.fn() },
  $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
};
const mockPrisma = { db: mockDb } as unknown as PrismaService;
const mockSubs = {
  activate: jest.fn(),
  bustStatusCache: jest.fn(),
};
const mockPayments = {
  verifyPayment: jest.fn(),
  rejectPayment: jest.fn(),
};
const mockAudit = {
  record: jest.fn(),
};

describe('AdminWriteService', () => {
  let service: AdminWriteService;

  beforeEach(() => {
    service = new AdminWriteService(
      mockPrisma,
      mockSubs as unknown as SubscriptionsService,
      mockPayments as unknown as SubscriptionPaymentsService,
      mockAudit as unknown as AdminAuditService,
    );
    tx.subscription.update.mockResolvedValue({ status: 'EXPIRED' });
    tx.organization.update.mockResolvedValue({ id: 'o1', status: 'SUSPENDED' });
    tx.user.update.mockResolvedValue({ id: 'u1', is_active: false });
    (bcrypt.hash as jest.Mock).mockResolvedValue('newhash');
  });

  describe('verifyPayment', () => {
    it('reuses the payments service and writes an audit row', async () => {
      mockPayments.verifyPayment.mockResolvedValue({
        status: 'VERIFIED',
      } as never);
      const res = await service.verifyPayment('admin-1', 'pay-1');

      expect(mockPayments.verifyPayment).toHaveBeenCalledWith(
        'pay-1',
        'admin-1',
      );
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId: 'admin-1',
          action: 'payment.verify',
          targetType: 'subscription_payment',
          targetId: 'pay-1',
        }),
      );
      expect(res).toEqual({ status: 'VERIFIED' });
    });
  });

  describe('rejectPayment', () => {
    it('passes the reason + rejector and audits the action', async () => {
      mockPayments.rejectPayment.mockResolvedValue({
        status: 'REJECTED',
      } as never);
      await service.rejectPayment('admin-1', 'pay-1', 'bad slip');

      expect(mockPayments.rejectPayment).toHaveBeenCalledWith(
        'pay-1',
        'bad slip',
        'admin-1',
      );
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'payment.reject' }),
      );
    });
  });

  describe('suspendSubscription', () => {
    it('sets EXPIRED, audits in-tx, and busts the status cache', async () => {
      mockDb.subscription.findFirst.mockResolvedValue({
        id: 's1',
        status: 'ACTIVE',
        organization_id: 'org-1',
      });

      await service.suspendSubscription('admin-1', 's1', 'overdue');

      expect(tx.subscription.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { status: SubscriptionStatus.EXPIRED },
      });
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'subscription.suspend',
          before: { status: 'ACTIVE' },
          after: { status: SubscriptionStatus.EXPIRED, reason: 'overdue' },
        }),
        tx,
      );
      expect(mockSubs.bustStatusCache).toHaveBeenCalledWith('org-1');
    });

    it('throws when the subscription does not exist', async () => {
      mockDb.subscription.findFirst.mockResolvedValue(null);
      await expect(
        service.suspendSubscription('admin-1', 'missing'),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('changePlan', () => {
    it('rejects an unknown plan code', async () => {
      mockDb.subscription.findFirst.mockResolvedValue({
        id: 's1',
        organization_id: 'org-1',
        subscription_plan_id: 'old',
      });
      mockDb.subscriptionPlan.findUnique.mockResolvedValue(null);
      await expect(
        service.changePlan('admin-1', 's1', 'ghost'),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('reuses activate() inside the tx and audits the switch', async () => {
      mockDb.subscription.findFirst.mockResolvedValue({
        id: 's1',
        organization_id: 'org-1',
        subscription_plan_id: 'old',
      });
      mockDb.subscriptionPlan.findUnique.mockResolvedValue({ id: 'plan-new' });
      mockSubs.activate.mockResolvedValue({ id: 's1' } as never);

      await service.changePlan('admin-1', 's1', 'center');

      expect(mockSubs.activate).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          subscriptionPlanId: 'plan-new',
        }),
        tx,
      );
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'subscription.change_plan' }),
        tx,
      );
      expect(mockSubs.bustStatusCache).toHaveBeenCalledWith('org-1');
    });
  });

  describe('deactivateUser', () => {
    it('flips is_active to false and audits', async () => {
      mockDb.user.findFirst.mockResolvedValue({ id: 'u1', is_active: true });
      await service.deactivateUser('admin-1', 'u1', 'fraud');

      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { is_active: false },
      });
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'user.deactivate',
          before: { is_active: true },
        }),
        tx,
      );
    });
  });

  describe('suspendOrganization', () => {
    it('sets the org SUSPENDED and audits', async () => {
      mockDb.organization.findFirst.mockResolvedValue({
        id: 'o1',
        status: 'ACTIVE',
      });
      await service.suspendOrganization('admin-1', 'o1');

      expect(tx.organization.update).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { status: OrganizationStatus.SUSPENDED },
      });
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'organization.suspend' }),
        tx,
      );
    });
  });

  describe('resetUserPassword', () => {
    it('hashes the new password and revokes the user sessions in-tx', async () => {
      mockDb.user.findFirst.mockResolvedValue({ id: 'u1' });
      await service.resetUserPassword('admin-1', 'u1', 'newsecret8');

      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: expect.objectContaining({ password_hashed: 'newhash' }),
      });
      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { user_id: 'u1', is_revoked: false },
        data: { is_revoked: true, revoked_at: expect.any(Date) },
      });
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.reset_password' }),
        tx,
      );
    });

    it('throws when the user does not exist', async () => {
      mockDb.user.findFirst.mockResolvedValue(null);
      await expect(
        service.resetUserPassword('admin-1', 'missing', 'newsecret8'),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
