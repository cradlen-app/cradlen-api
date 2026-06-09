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

const PASSWORD = 'Password1!';

/**
 * Security coverage for the signup OTP: attempt counting, the 5-attempt
 * lockout, expiry enforcement, and the resend cooldown. Each test uses a
 * fresh email so the per-identifier (ip:email) throttle buckets — which the
 * in-memory ThrottlerStorage keeps across `beforeEach` within this suite —
 * never collide.
 */
describe('Auth — OTP security (integration)', () => {
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

  function freshEmail(): string {
    return `otp-${randomUUID()}@example.com`;
  }

  // signup/start → returns { signupToken, otp }.
  async function startSignup(
    email: string,
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
      })
      .expect(201);
    return {
      signupToken: start.body.data.signup_token as string,
      otp: mailMock.mock.calls[callsBefore][1] as string,
    };
  }

  it('a wrong code is rejected (400) and increments the attempt counter', async () => {
    const email = freshEmail();
    const { signupToken, otp } = await startSignup(email);
    const wrong = otp === '000000' ? '111111' : '000000';

    await request(app.getHttpServer())
      .post('/v1/auth/signup/verify')
      .send({ signup_token: signupToken, code: wrong })
      .expect(400);

    const row = await prisma.verificationCode.findFirst({
      where: { target: email, consumed_at: null },
      orderBy: { created_at: 'desc' },
    });
    expect(row?.attempts).toBe(1);
  });

  it('locks out after 5 wrong attempts — even the correct code is then rejected', async () => {
    const email = freshEmail();
    const { signupToken, otp } = await startSignup(email);
    const wrong = otp === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/v1/auth/signup/verify')
        .send({ signup_token: signupToken, code: wrong })
        .expect(400);
    }

    // The 6th attempt trips the max-attempts gate before the code is compared,
    // so the genuine OTP no longer works.
    const res = await request(app.getHttpServer())
      .post('/v1/auth/signup/verify')
      .send({ signup_token: signupToken, code: otp })
      .expect(400);
    expect(res.body.error.code).toBe('MAX_ATTEMPTS_EXCEEDED');
  });

  it('rejects an expired code with CODE_EXPIRED', async () => {
    const email = freshEmail();
    const { signupToken, otp } = await startSignup(email);

    // Fast-forward expiry rather than waiting out the 15-minute TTL.
    await prisma.verificationCode.updateMany({
      where: { target: email, consumed_at: null },
      data: { expires_at: new Date(Date.now() - 60_000) },
    });

    const res = await request(app.getHttpServer())
      .post('/v1/auth/signup/verify')
      .send({ signup_token: signupToken, code: otp })
      .expect(400);
    expect(res.body.error.code).toBe('CODE_EXPIRED');
  });

  it('enforces the resend cooldown (429 on a second resend within the window)', async () => {
    const email = freshEmail();
    await startSignup(email);

    // First resend is allowed.
    await request(app.getHttpServer())
      .post('/v1/auth/signup/resend')
      .send({ email })
      .expect(200);

    // A second resend inside the cooldown is rejected.
    await request(app.getHttpServer())
      .post('/v1/auth/signup/resend')
      .send({ email })
      .expect(429);
  });
});
