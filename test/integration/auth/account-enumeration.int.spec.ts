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
import { signupOwner } from '../../helpers/auth-helpers';

/**
 * Account-enumeration surface of the public, unauthenticated auth endpoints.
 *
 * `POST /auth/forgot-password` is deliberately *non-enumerable*: for an unknown
 * email it returns a well-formed reset token with the same shape (and burns the
 * same bcrypt wall-clock) as the real path (PasswordResetService.start). This
 * spec locks that uniformity in so a refactor cannot regress it into an oracle.
 *
 * `GET /auth/registration/status` is the one *accepted* oracle: it returns
 * `{ step: 'NONE' }` for an unknown email and a real onboarding step for a known
 * one, bounded by a tight per-IP throttle (auth.controller documents the
 * trade-off). This spec pins that contract so any change to it is a deliberate,
 * reviewed act rather than an accidental widening of the oracle.
 */
describe('Auth — account enumeration surface (integration)', () => {
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

  it('forgot-password returns an identical response shape for a known vs unknown email (no oracle)', async () => {
    const owner = await signupOwner(app, mailMock);
    const unknownEmail = `ghost-${randomUUID()}@example.com`;

    const known = await request(app.getHttpServer())
      .post('/v1/auth/forgot-password')
      .send({ email: owner.email })
      .expect(200);

    const unknown = await request(app.getHttpServer())
      .post('/v1/auth/forgot-password')
      .send({ email: unknownEmail })
      .expect(200);

    // Same status, same keys, both carry a non-empty reset_token — an attacker
    // cannot tell a registered email from an unregistered one by the response.
    expect(Object.keys(known.body.data).sort()).toEqual(
      Object.keys(unknown.body.data).sort(),
    );
    expect(typeof known.body.data.reset_token).toBe('string');
    expect(typeof unknown.body.data.reset_token).toBe('string');
    expect(known.body.data.reset_token.length).toBeGreaterThan(0);
    expect(unknown.body.data.reset_token.length).toBeGreaterThan(0);
  });

  it('registration/status returns NONE for an unknown email and a real step for a known one (accepted, throttled oracle)', async () => {
    const owner = await signupOwner(app, mailMock);
    const unknownEmail = `ghost-${randomUUID()}@example.com`;

    const unknown = await request(app.getHttpServer())
      .get('/v1/auth/registration/status')
      .query({ email: unknownEmail })
      .expect(200);
    expect(unknown.body.data.step).toBe('NONE');

    const known = await request(app.getHttpServer())
      .get('/v1/auth/registration/status')
      .query({ email: owner.email })
      .expect(200);
    // A fully onboarded owner resolves to DONE — the point is only that a known
    // account is distinguishable from NONE. If this contract changes, update the
    // report's enumeration finding alongside it.
    expect(known.body.data.step).not.toBe('NONE');
  });
});
