import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { createTestApp } from '../../helpers/app-factory';
import { cleanDatabase } from '../../helpers/db-cleaner';
import {
  disconnectTestPrisma,
  getTestPrisma,
} from '../../helpers/prisma-test-client';
import {
  bearer,
  DEFAULT_PASSWORD,
  loginAndSelect,
  roleIdByCode,
  signupOwner,
} from '../../helpers/auth-helpers';

/**
 * The cross-org invitation-accept flow — the path that enables a consultant to
 * hold a Profile in more than one organization against a single User. Covers
 * the new-user branch, the existing-user credential gate, and the
 * decline-then-accept rejection.
 */
describe('Auth — invitation accept (integration)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;
  let prisma: PrismaClient;

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

  /**
   * OWNER creates a STAFF invitation for `email` and returns its id + the raw
   * token (read out of the accept URL emailed to the invitee).
   */
  async function createInvite(
    ownerToken: string,
    orgId: string,
    branchId: string,
    email: string,
  ): Promise<{ invitationId: string; token: string }> {
    const staffRoleId = await roleIdByCode(prisma, 'STAFF');
    mailMock.mockClear();
    const res = await bearer(ownerToken)(
      request(app.getHttpServer()).post(
        `/v1/organizations/${orgId}/branches/${branchId}/invitations`,
      ),
    )
      .send({
        email,
        first_name: 'New',
        last_name: 'Hire',
        role_ids: [staffRoleId],
        branch_ids: [branchId],
      })
      .expect(201);

    const inviteUrl = mailMock.mock.calls[0][1] as string;
    const token = /[?&]token=([^&]+)/.exec(inviteUrl)?.[1] as string;
    return { invitationId: res.body.data.id as string, token };
  }

  it('a brand-new invitee can preview, accept, and then log in', async () => {
    const owner = await signupOwner(app, mailMock, {
      organizationName: 'Org A',
    });
    const inviteeEmail = `consultant-${randomUUID()}@example.com`;
    const { invitationId, token } = await createInvite(
      owner.accessToken,
      owner.orgId,
      owner.branchId,
      inviteeEmail,
    );
    const http = app.getHttpServer();

    // Public preview reflects the invitation.
    const preview = await request(http)
      .get('/v1/invitations/preview')
      .query({ invitation_id: invitationId, token })
      .expect(200);
    expect(preview.body.data.email).toBe(inviteeEmail);

    // Accept → creates User + Profile in Org A.
    const accept = await request(http)
      .post('/v1/invitations/accept')
      .send({ invitation_id: invitationId, token, password: DEFAULT_PASSWORD })
      .expect(201);
    expect(accept.body.data.organization_id).toBe(owner.orgId);

    // The new account can authenticate and reach a protected route.
    const session = await loginAndSelect(app, inviteeEmail);
    await request(http)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    const user = await prisma.user.findFirstOrThrow({
      where: { email: inviteeEmail },
    });
    expect(
      await prisma.profile.count({
        where: { user_id: user.id, organization_id: owner.orgId },
      }),
    ).toBe(1);
  });

  it('an existing user must supply their real password; a correct one adds a 2nd profile to the same user', async () => {
    const ownerA = await signupOwner(app, mailMock, {
      organizationName: 'Org A',
    });
    // The invitee already owns Org B (an existing User with DEFAULT_PASSWORD).
    const ownerB = await signupOwner(app, mailMock, {
      organizationName: 'Org B',
    });
    const { invitationId, token } = await createInvite(
      ownerA.accessToken,
      ownerA.orgId,
      ownerA.branchId,
      ownerB.email,
    );
    const http = app.getHttpServer();

    // Wrong password → rejected, invitation stays redeemable.
    await request(http)
      .post('/v1/invitations/accept')
      .send({
        invitation_id: invitationId,
        token,
        password: 'WrongPass1!',
      })
      .expect(401);

    // Correct existing password → a second Profile on the same User.
    await request(http)
      .post('/v1/invitations/accept')
      .send({ invitation_id: invitationId, token, password: ownerB.password })
      .expect(201);

    expect(await prisma.user.count({ where: { email: ownerB.email } })).toBe(1);
    const user = await prisma.user.findFirstOrThrow({
      where: { email: ownerB.email },
    });
    expect(await prisma.profile.count({ where: { user_id: user.id } })).toBe(2);
  });

  it('a declined invitation can no longer be accepted', async () => {
    const owner = await signupOwner(app, mailMock, {
      organizationName: 'Org A',
    });
    const inviteeEmail = `declined-${randomUUID()}@example.com`;
    const { invitationId, token } = await createInvite(
      owner.accessToken,
      owner.orgId,
      owner.branchId,
      inviteeEmail,
    );
    const http = app.getHttpServer();

    await request(http)
      .post('/v1/invitations/decline')
      .send({ invitation_id: invitationId, token })
      .expect(200);

    await request(http)
      .post('/v1/invitations/accept')
      .send({ invitation_id: invitationId, token, password: DEFAULT_PASSWORD })
      .expect(401);
  });
});
