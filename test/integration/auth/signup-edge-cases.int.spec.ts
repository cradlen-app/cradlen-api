import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { createTestApp } from '../../helpers/app-factory';
import { cleanDatabase } from '../../helpers/db-cleaner';
import {
  disconnectTestPrisma,
  getTestPrisma,
} from '../../helpers/prisma-test-client';

const PASSWORD = 'Password1!';

/**
 * Signup edge cases NOT covered by the happy-path (signup-full-flow),
 * the race (signup-race), or the OTP-security suite (otp-security covers
 * wrong-code attempts, the 5-attempt lockout, expiry, and resend cooldown).
 *
 * Focus here: duplicate-identity conflicts on /start, PENDING-resume
 * behavior, the not-yet-verified guard on /complete, and transactional
 * rollback when /complete is given an unknown job_function_code.
 *
 * Each test uses a fresh email so the per-identifier (ip:email) throttle
 * buckets — kept in the in-memory ThrottlerStorage across beforeEach within
 * this suite — never collide.
 */
describe('Auth — signup edge cases (integration)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;
  let prisma: PrismaClient;
  // The in-memory throttle storage is a Map exposed via a getter; clearing it
  // between tests prevents the per-IP /signup/start cap (5/10min) from bleeding
  // across this suite's many fresh-email signups.
  let throttleStorage: ThrottlerStorage & { storage: Map<string, unknown> };

  beforeAll(async () => {
    mailMock = jest.fn().mockResolvedValue(undefined);
    app = await createTestApp(mailMock);
    prisma = getTestPrisma();
    throttleStorage = app.get<ThrottlerStorage>(
      ThrottlerStorage,
    ) as ThrottlerStorage & { storage: Map<string, unknown> };
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestPrisma();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    mailMock.mockClear();
    throttleStorage.storage.clear();
  });

  const freshEmail = () => `signup-${randomUUID()}@example.com`;

  async function startSignup(
    email: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ signupToken: string; otp: string }> {
    const callsBefore = mailMock.mock.calls.length;
    const start = await request(app.getHttpServer())
      .post('/v1/auth/signup/start')
      .send({
        first_name: 'Sara',
        last_name: 'Ali',
        email,
        password: PASSWORD,
        confirm_password: PASSWORD,
        ...extra,
      })
      .expect(201);
    return {
      signupToken: start.body.data.signup_token as string,
      otp: mailMock.mock.calls[callsBefore][1] as string,
    };
  }

  it('returns 409 with details.fields=[email] when starting signup for an already-verified email', async () => {
    const email = freshEmail();
    const { signupToken, otp } = await startSignup(email);
    await request(app.getHttpServer())
      .post('/v1/auth/signup/verify')
      .send({ signup_token: signupToken, code: otp })
      .expect(200);

    // The identity is now ACTIVE (verified). A second /start must conflict.
    const conflict = await request(app.getHttpServer())
      .post('/v1/auth/signup/start')
      .send({
        first_name: 'Sara',
        last_name: 'Ali',
        email,
        password: PASSWORD,
        confirm_password: PASSWORD,
      })
      .expect(409);

    expect(conflict.body.error.code).toBeDefined();
    expect(conflict.body.error.details.fields).toContain('email');
    // Still exactly one user row — no duplicate identity was created.
    expect(await prisma.user.count()).toBe(1);
  });

  it('resumes a PENDING signup on a repeated /start: re-sends OTP, mints a token, no duplicate user', async () => {
    const email = freshEmail();
    await startSignup(email); // first OTP
    expect(await prisma.user.count()).toBe(1);

    const second = await request(app.getHttpServer())
      .post('/v1/auth/signup/start')
      .send({
        first_name: 'Sara',
        last_name: 'Ali',
        email,
        password: PASSWORD,
        confirm_password: PASSWORD,
      })
      .expect(201);

    expect(second.body.data.signup_token).toEqual(expect.any(String));
    // No second user row; a second verification email was dispatched.
    expect(await prisma.user.count()).toBe(1);
    expect(mailMock.mock.calls.length).toBe(2);
  });

  it('returns 409 on a phone-only collision without issuing a token or sending email', async () => {
    const phone = '+201000000001';
    // First identity claims the phone.
    await startSignup(freshEmail(), { phone_number: phone });
    const callsAfterFirst = mailMock.mock.calls.length;

    const conflict = await request(app.getHttpServer())
      .post('/v1/auth/signup/start')
      .send({
        first_name: 'Other',
        last_name: 'Person',
        email: freshEmail(), // different email, same phone
        phone_number: phone,
        password: PASSWORD,
        confirm_password: PASSWORD,
      })
      .expect(409);

    expect(conflict.body.error.details.fields).toContain('phone_number');
    // No new user, and no extra OTP email for the colliding attempt.
    expect(await prisma.user.count()).toBe(1);
    expect(mailMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('returns 403 when completing onboarding before the email is verified', async () => {
    const email = freshEmail();
    const { signupToken } = await startSignup(email); // PENDING, not verified

    await request(app.getHttpServer())
      .post('/v1/auth/signup/complete')
      .send({
        signup_token: signupToken,
        organization_name: 'Cradlen Clinic',
        specialties: ['OBGYN'],
        branch_name: 'Main',
        branch_address: '1 St',
        branch_city: 'Cairo',
        branch_governorate: 'Cairo',
      })
      .expect(403);

    // No tenant rows materialized.
    expect(await prisma.organization.count()).toBe(0);
    expect(await prisma.profile.count()).toBe(0);
  });

  it('rolls back the whole onboarding transaction when an unknown job_function_code is supplied', async () => {
    const email = freshEmail();
    const { signupToken, otp } = await startSignup(email);
    const verified = await request(app.getHttpServer())
      .post('/v1/auth/signup/verify')
      .send({ signup_token: signupToken, code: otp })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/v1/auth/signup/complete')
      .send({
        signup_token: verified.body.data.signup_token,
        organization_name: 'Cradlen Clinic',
        specialties: ['OBGYN'],
        branch_name: 'Main',
        branch_address: '1 St',
        branch_city: 'Cairo',
        branch_governorate: 'Cairo',
        job_function_code: 'TOTALLY_BOGUS_FN',
      })
      .expect(400);

    expect(res.body.error.message).toContain('TOTALLY_BOGUS_FN');
    // Validation runs before the transaction — nothing was created.
    expect(await prisma.organization.count()).toBe(0);
    expect(await prisma.profile.count()).toBe(0);
    expect(await prisma.subscription.count()).toBe(0);
  });
});
