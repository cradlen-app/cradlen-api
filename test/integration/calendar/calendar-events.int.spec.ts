import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createTestApp } from '../../helpers/app-factory';
import { cleanDatabase } from '../../helpers/db-cleaner';
import {
  disconnectTestPrisma,
  getTestPrisma,
} from '../../helpers/prisma-test-client';
import { bearer, seedMember } from '../../helpers/auth-helpers';
import { seedOrg } from '../../helpers/financial-helpers';

/**
 * Calendar CRUD + visibility matrix against real Postgres.
 *
 * Surface: POST/GET/PATCH/DELETE /v1/calendar/events, GET .../:id, and
 * GET .../profiles/:profileId — all behind the staff JwtAuthGuard.
 *
 * Visibility model (read from calendar.service.ts):
 *  - PRIVATE event  → visible only to its owner. Another same-org profile
 *    gets 404 on GET :id and never sees it in the list or the profile view.
 *  - ORGANIZATION event → visible to same-org profiles that can access its
 *    branch (or org-wide when branch_id is null, as an OWNER broadcast).
 *  - Edit/delete are owner-keyed: a non-owner PATCH/DELETE resolves nothing
 *    and surfaces as 404 (loadOwned throws NotFound; remove keys the update on
 *    profile_id → P2025 → 404), NOT 403.
 *  - GET /profiles/:profileId reuses the list visibility filter, so the
 *    target's PRIVATE events are excluded.
 */
describe('Calendar — events CRUD + visibility (integration)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;
  let prisma: PrismaClient;
  const jwt = new JwtService({});

  const http = () => app.getHttpServer();

  // A wide window covering every event the suite creates.
  const FROM = '2030-01-01T00:00:00.000Z';
  const TO = '2030-12-31T00:00:00.000Z';

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

  /** Mint a staff access token directly (no HTTP login). */
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

  async function setup() {
    const org = await seedOrg(prisma, 'Calendar Clinic', 'owner.cal@example.com');
    const member = await seedMember(prisma, {
      orgId: org.org.id,
      branchId: org.branch.id,
      email: 'member.cal@example.com',
      roleCode: 'STAFF',
      assignToBranch: true,
    });
    const ownerAuth = await authFor(org.ownerProfileId, org.org.id, org.branch.id);
    const memberAuth = await authFor(member.profileId, org.org.id, org.branch.id);
    return { org, member, ownerAuth, memberAuth };
  }

  const privateEvent = (over: Record<string, unknown> = {}) => ({
    event_type: 'MEETING', // defaults to PRIVATE
    title: 'Owner private meeting',
    start_at: '2030-03-01T09:00:00.000Z',
    end_at: '2030-03-01T10:00:00.000Z',
    ...over,
  });

  const orgEvent = (over: Record<string, unknown> = {}) => ({
    event_type: 'DAY_OFF', // defaults to ORGANIZATION
    visibility: 'ORGANIZATION',
    title: 'Clinic day off',
    start_at: '2030-04-01T00:00:00.000Z',
    end_at: '2030-04-02T00:00:00.000Z',
    all_day: true,
    ...over,
  });

  describe('CRUD lifecycle (owner)', () => {
    it('creates, reads, updates and soft-deletes an event', async () => {
      const { org, ownerAuth } = await setup();

      const created = await ownerAuth(
        request(http()).post('/v1/calendar/events'),
      )
        .send(privateEvent())
        .expect(201);

      const id = created.body.data.id as string;
      expect(created.body.data.visibility).toBe('PRIVATE');
      expect(created.body.data.profile_id).toBe(org.ownerProfileId);
      expect(created.body.data.event_type).toBe('MEETING');

      // GET :id
      const fetched = await ownerAuth(
        request(http()).get(`/v1/calendar/events/${id}`),
      ).expect(200);
      expect(fetched.body.data.id).toBe(id);

      // PATCH
      const patched = await ownerAuth(
        request(http()).patch(`/v1/calendar/events/${id}`),
      )
        .send({ title: 'Renamed meeting' })
        .expect(200);
      expect(patched.body.data.title).toBe('Renamed meeting');

      // DELETE (204)
      await ownerAuth(
        request(http()).delete(`/v1/calendar/events/${id}`),
      ).expect(204);

      // Gone afterwards
      await ownerAuth(
        request(http()).get(`/v1/calendar/events/${id}`),
      ).expect(404);

      // soft-deleted in the DB
      const row = await prisma.calendarEvent.findUnique({ where: { id } });
      expect(row?.is_deleted).toBe(true);
    });

    it('rejects an inverted time window with 400', async () => {
      const { ownerAuth } = await setup();
      await ownerAuth(request(http()).post('/v1/calendar/events'))
        .send(
          privateEvent({
            start_at: '2030-03-01T10:00:00.000Z',
            end_at: '2030-03-01T09:00:00.000Z',
          }),
        )
        .expect(400);
    });
  });

  describe('PRIVATE event visibility', () => {
    it('is invisible to another same-org profile (404 on GET :id, absent from list & profile view)', async () => {
      const { org, member, ownerAuth, memberAuth } = await setup();

      const created = await ownerAuth(
        request(http()).post('/v1/calendar/events'),
      )
        .send(privateEvent())
        .expect(201);
      const id = created.body.data.id as string;

      // Owner can read it
      await ownerAuth(
        request(http()).get(`/v1/calendar/events/${id}`),
      ).expect(200);

      // Member cannot read it directly
      await memberAuth(
        request(http()).get(`/v1/calendar/events/${id}`),
      ).expect(404);

      // Member's own list excludes it
      const memberList = await memberAuth(
        request(http()).get(`/v1/calendar/events?from=${FROM}&to=${TO}`),
      ).expect(200);
      const memberIds = (memberList.body.data as Array<{ id: string }>).map(
        (e) => e.id,
      );
      expect(memberIds).not.toContain(id);

      // Member viewing the OWNER's profile calendar still doesn't see it
      const profileView = await memberAuth(
        request(http()).get(
          `/v1/calendar/events/profiles/${org.ownerProfileId}?from=${FROM}&to=${TO}`,
        ),
      ).expect(200);
      const profileIds = (profileView.body.data as Array<{ id: string }>).map(
        (e) => e.id,
      );
      expect(profileIds).not.toContain(id);

      // Owner's own list DOES include it
      const ownerList = await ownerAuth(
        request(http()).get(`/v1/calendar/events?from=${FROM}&to=${TO}`),
      ).expect(200);
      const ownerIds = (ownerList.body.data as Array<{ id: string }>).map(
        (e) => e.id,
      );
      expect(ownerIds).toContain(id);

      // sanity: member is a distinct profile in the same org
      expect(member.profileId).not.toBe(org.ownerProfileId);
    });
  });

  describe('ORGANIZATION event visibility', () => {
    it('an org-wide (null-branch) event is visible to another same-org profile', async () => {
      const { org, ownerAuth, memberAuth } = await setup();

      // OWNER creating an ORGANIZATION event without branch_id → org-wide broadcast.
      const created = await ownerAuth(
        request(http()).post('/v1/calendar/events'),
      )
        .send(orgEvent())
        .expect(201);
      const id = created.body.data.id as string;
      expect(created.body.data.visibility).toBe('ORGANIZATION');
      expect(created.body.data.branch_id).toBeNull();

      // Member can read it directly
      await memberAuth(
        request(http()).get(`/v1/calendar/events/${id}`),
      ).expect(200);

      // Member sees it in their list
      const memberList = await memberAuth(
        request(http()).get(`/v1/calendar/events?from=${FROM}&to=${TO}`),
      ).expect(200);
      const ids = (memberList.body.data as Array<{ id: string }>).map(
        (e) => e.id,
      );
      expect(ids).toContain(id);

      // And in the owner's profile view
      const profileView = await memberAuth(
        request(http()).get(
          `/v1/calendar/events/profiles/${org.ownerProfileId}?from=${FROM}&to=${TO}`,
        ),
      ).expect(200);
      const pIds = (profileView.body.data as Array<{ id: string }>).map(
        (e) => e.id,
      );
      expect(pIds).toContain(id);
    });

    it('a branch-tagged ORGANIZATION event is visible to a profile assigned to that branch', async () => {
      const { org, ownerAuth, memberAuth } = await setup();

      const created = await ownerAuth(
        request(http()).post('/v1/calendar/events'),
      )
        .send(orgEvent({ branch_id: org.branch.id, title: 'Branch standup' }))
        .expect(201);
      const id = created.body.data.id as string;
      expect(created.body.data.branch_id).toBe(org.branch.id);

      // Member is assigned to that branch and has it as active branch → visible
      await memberAuth(
        request(http()).get(`/v1/calendar/events/${id}`),
      ).expect(200);

      const memberList = await memberAuth(
        request(http()).get(`/v1/calendar/events?from=${FROM}&to=${TO}`),
      ).expect(200);
      const ids = (memberList.body.data as Array<{ id: string }>).map(
        (e) => e.id,
      );
      expect(ids).toContain(id);
    });
  });

  describe('owner-only edit/delete', () => {
    it('a non-owner PATCH resolves nothing → 404', async () => {
      const { ownerAuth, memberAuth } = await setup();
      const created = await ownerAuth(
        request(http()).post('/v1/calendar/events'),
      )
        .send(orgEvent())
        .expect(201);
      const id = created.body.data.id as string;

      // Even though the member can SEE the org event, they can't edit it.
      await memberAuth(
        request(http()).patch(`/v1/calendar/events/${id}`),
      )
        .send({ title: 'Hijacked' })
        .expect(404);

      // Untouched
      const row = await prisma.calendarEvent.findUnique({ where: { id } });
      expect(row?.title).toBe('Clinic day off');
    });

    it('a non-owner DELETE resolves nothing → 404 and leaves the row intact', async () => {
      const { ownerAuth, memberAuth } = await setup();
      const created = await ownerAuth(
        request(http()).post('/v1/calendar/events'),
      )
        .send(orgEvent())
        .expect(201);
      const id = created.body.data.id as string;

      await memberAuth(
        request(http()).delete(`/v1/calendar/events/${id}`),
      ).expect(404);

      const row = await prisma.calendarEvent.findUnique({ where: { id } });
      expect(row?.is_deleted).toBe(false);
    });
  });

  describe('cross-org isolation', () => {
    it('an event in another org is not readable (404)', async () => {
      const { ownerAuth } = await setup();
      const other = await seedOrg(prisma, 'Other Clinic', 'owner.other@example.com');
      const otherAuth = await authFor(
        other.ownerProfileId,
        other.org.id,
        other.branch.id,
      );

      const created = await otherAuth(
        request(http()).post('/v1/calendar/events'),
      )
        .send(orgEvent({ title: 'Other org day off' }))
        .expect(201);
      const id = created.body.data.id as string;

      // First org's owner cannot read the other org's event
      await ownerAuth(
        request(http()).get(`/v1/calendar/events/${id}`),
      ).expect(404);
    });
  });
});
