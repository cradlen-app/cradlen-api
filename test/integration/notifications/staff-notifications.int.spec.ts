import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createTestApp } from '../../helpers/app-factory';
import { cleanDatabase } from '../../helpers/db-cleaner';
import {
  disconnectTestPrisma,
  getTestPrisma,
} from '../../helpers/prisma-test-client';
import { bearer, seedMember } from '../../helpers/auth-helpers';
import { seedOrg, seedReceptionist } from '../../helpers/financial-helpers';
import { EventBus } from '@infrastructure/messaging/event-bus';

/**
 * Staff notifications against real Postgres.
 *
 * Surface: GET /v1/notifications (paginated, optional ?category),
 * PATCH /v1/notifications/read-all, PATCH /v1/notifications/:id/read — all
 * behind the staff JwtAuthGuard, scoped to the caller's profile.
 *
 * Proves: profile scoping (A's rows are invisible to B), ownership on mutate
 * (mark-read of a row you don't own → 404; read-all touches only your rows),
 * and one listener path end-to-end: charge.captured(source=DOCTOR) → a
 * Notification row for the branch's receptionist.
 */
describe('Notifications — staff inbox + scoping + listener (integration)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;
  let prisma: PrismaClient;
  const jwt = new JwtService({});

  const http = () => app.getHttpServer();

  beforeAll(async () => {
    mailMock = jest.fn().mockResolvedValue(undefined);
    app = await createTestApp(mailMock);
    prisma = getTestPrisma();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestPrisma();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    mailMock.mockClear();
  });

  async function authFor(profileId: string, orgId: string, branchId?: string) {
    const { user_id } = await prisma.profile.findUniqueOrThrow({
      where: { id: profileId },
      select: { user_id: true },
    });
    return bearer(
      jwt.sign(
        {
          userId: user_id,
          profileId,
          organizationId: orgId,
          activeBranchId: branchId,
          type: 'access',
        },
        { secret: process.env.JWT_ACCESS_SECRET!, expiresIn: '15m' },
      ),
    );
  }

  /** Insert a Notification row straight into the DB for a given profile. */
  function seedNotification(
    profileId: string,
    over: Partial<{
      code: string;
      category: string;
      title: string;
      description: string;
    }> = {},
  ) {
    return prisma.notification.create({
      data: {
        profile_id: profileId,
        code: over.code ?? 'system.test',
        category: over.category ?? 'system',
        title: over.title ?? 'Test notification',
        description: over.description ?? 'A seeded notification row',
      },
    });
  }

  async function setup() {
    const org = await seedOrg(
      prisma,
      'Notify Clinic',
      'owner.notify@example.com',
    );
    const memberB = await seedMember(prisma, {
      orgId: org.org.id,
      branchId: org.branch.id,
      email: 'member.b@example.com',
      roleCode: 'STAFF',
      assignToBranch: true,
    });
    const authA = await authFor(org.ownerProfileId, org.org.id, org.branch.id);
    const authB = await authFor(memberB.profileId, org.org.id, org.branch.id);
    return { org, memberB, authA, authB, profileA: org.ownerProfileId };
  }

  describe('profile scoping', () => {
    it("returns the caller's notifications and hides another profile's", async () => {
      const { authA, authB, profileA, memberB } = await setup();

      const nA = await seedNotification(profileA, { title: 'For A' });
      await seedNotification(memberB.profileId, { title: 'For B' });

      const listA = await authA(
        request(http()).get('/v1/notifications'),
      ).expect(200);
      const idsA = (listA.body.data as Array<{ id: string }>).map((n) => n.id);
      expect(idsA).toContain(nA.id);
      expect(listA.body.data).toHaveLength(1);
      expect(listA.body.meta.unreadCount).toBe(1);

      const listB = await authB(
        request(http()).get('/v1/notifications'),
      ).expect(200);
      const idsB = (listB.body.data as Array<{ id: string }>).map((n) => n.id);
      expect(idsB).not.toContain(nA.id);
      expect(listB.body.data).toHaveLength(1);
    });

    it('filters by ?category', async () => {
      const { authA, profileA } = await setup();
      await seedNotification(profileA, { category: 'billing', title: 'Bill' });
      await seedNotification(profileA, { category: 'staff', title: 'Staffy' });

      const billing = await authA(
        request(http()).get('/v1/notifications?category=billing'),
      ).expect(200);
      expect(billing.body.data).toHaveLength(1);
      expect(billing.body.data[0].category).toBe('billing');
    });
  });

  describe('ownership on mutate', () => {
    it('mark-read of a row you do not own → 404', async () => {
      const { authB, profileA } = await setup();
      const nA = await seedNotification(profileA);

      await authB(
        request(http()).patch(`/v1/notifications/${nA.id}/read`),
      ).expect(404);

      const row = await prisma.notification.findUnique({
        where: { id: nA.id },
      });
      expect(row?.is_read).toBe(false);
    });

    it('owner mark-read returns the row flagged read', async () => {
      const { authA, profileA } = await setup();
      const nA = await seedNotification(profileA);

      const res = await authA(
        request(http()).patch(`/v1/notifications/${nA.id}/read`),
      ).expect(200);
      expect(res.body.data.id).toBe(nA.id);
      expect(res.body.data.is_read).toBe(true);
      expect(res.body.data.read_at).not.toBeNull();
    });

    it('read-all marks only the caller’s notifications', async () => {
      const { authA, profileA, memberB } = await setup();
      await seedNotification(profileA, { title: 'A1' });
      await seedNotification(profileA, { title: 'A2' });
      const nB = await seedNotification(memberB.profileId, { title: 'B1' });

      await authA(request(http()).patch('/v1/notifications/read-all')).expect(
        204,
      );

      const aUnread = await prisma.notification.count({
        where: { profile_id: profileA, is_read: false },
      });
      expect(aUnread).toBe(0);

      // B's notification stays unread
      const bRow = await prisma.notification.findUnique({
        where: { id: nB.id },
      });
      expect(bRow?.is_read).toBe(false);
    });
  });

  describe('listener: charge.captured(source=DOCTOR) → receptionist notification', () => {
    it('writes a billing notification for the branch receptionist', async () => {
      const org = await seedOrg(
        prisma,
        'Listener Clinic',
        'owner.listener@example.com',
      );
      const receptionistProfileId = await seedReceptionist(
        prisma,
        org.org.id,
        org.branch.id,
        'recep.listener@example.com',
      );

      const eventBus = app.get(EventBus);

      // Publish a doctor-sourced charge capture. The listener only hard-requires
      // a matching branch receptionist; patient/service/visit lookups tolerate
      // missing rows, so we can drive it with synthetic ids.
      eventBus.publish('charge.captured', {
        charge_id: randomUUID(),
        organization_id: org.org.id,
        branch_id: org.branch.id,
        patient_id: randomUUID(),
        visit_id: null,
        service_id: null,
        amount: new Prisma.Decimal('100.00'),
        pricing_source: 'CUSTOM',
        source: 'DOCTOR',
        captured_by_id: org.ownerProfileId,
      });

      // Listener runs async; poll briefly for the row to appear.
      const found = await waitFor(async () => {
        const count = await prisma.notification.count({
          where: {
            profile_id: receptionistProfileId,
            code: 'billing.service_charge_added',
          },
        });
        return count > 0 ? count : null;
      });
      expect(found).toBe(1);

      const notif = await prisma.notification.findFirstOrThrow({
        where: { profile_id: receptionistProfileId },
      });
      expect(notif.category).toBe('billing');

      // The receptionist can read it via the HTTP inbox.
      const auth = await authFor(
        receptionistProfileId,
        org.org.id,
        org.branch.id,
      );
      const list = await auth(
        request(http()).get('/v1/notifications?category=billing'),
      ).expect(200);
      expect(list.body.data).toHaveLength(1);
      // NotificationDto does not expose `code` (the mapper strips it); the
      // machine key was already asserted at the DB layer above.
      expect(list.body.data[0].category).toBe('billing');
      expect(list.body.data[0].id).toBe(notif.id);
    });

    it('a reception-sourced charge does NOT notify (source guard)', async () => {
      const org = await seedOrg(
        prisma,
        'Guard Clinic',
        'owner.guard@example.com',
      );
      const receptionistProfileId = await seedReceptionist(
        prisma,
        org.org.id,
        org.branch.id,
        'recep.guard@example.com',
      );

      const eventBus = app.get(EventBus);
      eventBus.publish('charge.captured', {
        charge_id: randomUUID(),
        organization_id: org.org.id,
        branch_id: org.branch.id,
        patient_id: randomUUID(),
        visit_id: null,
        service_id: null,
        amount: new Prisma.Decimal('50.00'),
        pricing_source: 'CUSTOM',
        source: 'RECEPTION',
        captured_by_id: receptionistProfileId,
      });

      // Give the (no-op) handler a moment, then assert nothing was written.
      await new Promise((r) => setTimeout(r, 500));
      const count = await prisma.notification.count({
        where: { profile_id: receptionistProfileId },
      });
      expect(count).toBe(0);
    });
  });
});

/** Poll `fn` until it returns non-null or the attempts run out. */
async function waitFor<T>(
  fn: () => Promise<T | null>,
  attempts = 40,
  intervalMs = 100,
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    const result = await fn();
    if (result !== null) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('waitFor: condition not met within timeout');
}
