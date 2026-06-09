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
  signAlgNone,
  signExpiredToken,
  signWithType,
  signWithWrongSecret,
} from '../../helpers/jwt-factory';
import { signupOwner } from '../../helpers/auth-helpers';

/**
 * Security coverage for the JWT verification + audience rules that the global
 * JwtAuthGuard enforces. `GET /v1/auth/me` is the representative protected
 * staff route; every forged / wrong-type / cross-audience / stale token must
 * be rejected with 401 before any handler runs.
 */
describe('Auth — token security (integration)', () => {
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

  // A structurally-plausible payload for forgeries. Ids are irrelevant for the
  // signature / type / expiry checks, which all reject before the DB lookup.
  const fakePayload = (): Record<string, unknown> => ({
    userId: randomUUID(),
    profileId: randomUUID(),
    organizationId: randomUUID(),
  });

  it('rejects a request with no Authorization header (auth required by default)', async () => {
    await request(app.getHttpServer()).get('/v1/auth/me').expect(401);
  });

  it('rejects a malformed bearer token', async () => {
    await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', 'Bearer not-a-real-jwt')
      .expect(401);
  });

  it('rejects a token signed with the wrong secret (forgery)', async () => {
    await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${signWithWrongSecret(fakePayload())}`)
      .expect(401);
  });

  it('rejects an unsigned alg:none token', async () => {
    await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${signAlgNone(fakePayload())}`)
      .expect(401);
  });

  it('rejects an expired access token', async () => {
    const token = signExpiredToken({ ...fakePayload(), type: 'access' });
    await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects a real refresh token used as an access token (type confusion)', async () => {
    const owner = await signupOwner(app, mailMock);
    await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${owner.refreshToken}`)
      .expect(401);
  });

  it('rejects a token whose type claim is password_reset', async () => {
    const token = signWithType(fakePayload(), 'password_reset');
    await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects a staff access token on a patient-portal route (cross-audience)', async () => {
    const owner = await signupOwner(app, mailMock);
    await request(app.getHttpServer())
      .get('/v1/patient-auth/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(401);
  });

  it('rejects a previously-valid access token once its profile is soft-deleted', async () => {
    const owner = await signupOwner(app, mailMock);

    // Token works while the profile is live.
    await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    await prisma.profile.update({
      where: { id: owner.profileId },
      data: { is_deleted: true, deleted_at: new Date() },
    });

    // getProfileContext can no longer resolve the profile → 401.
    await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(401);
  });
});
