import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp } from '../../helpers/app-factory';
import { cleanDatabase } from '../../helpers/db-cleaner';
import {
  disconnectTestPrisma,
  getTestPrisma,
} from '../../helpers/prisma-test-client';

const PASSWORD = 'Password1!';
const NEW_PASSWORD = 'NewPassword1!';

/**
 * Integration coverage for S-04. Confirms a verified reset token is
 * single-use even against a real Postgres + the new
 * password_reset_tokens table.
 */
describe('Auth — password reset reuse prevention (integration)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;

  beforeAll(async () => {
    mailMock = jest.fn().mockResolvedValue(undefined);
    app = await createTestApp(mailMock);
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestPrisma();
  });

  beforeEach(async () => {
    await cleanDatabase(getTestPrisma());
    mailMock.mockClear();
  });

  async function bootstrapUser(): Promise<void> {
    const http = app.getHttpServer();
    const start = await request(http)
      .post('/v1/auth/signup/start')
      .send({
        first_name: 'Sara',
        last_name: 'Ali',
        email: 'sara@example.com',
        password: PASSWORD,
        confirm_password: PASSWORD,
      })
      .expect(201);
    const otp = mailMock.mock.calls[0][1] as string;
    const verified = await request(http)
      .post('/v1/auth/signup/verify')
      .send({ signup_token: start.body.data.signup_token, code: otp })
      .expect(200);
    await request(http)
      .post('/v1/auth/signup/complete')
      .send({
        signup_token: verified.body.data.signup_token,
        organization_name: 'Cradlen Clinic',
        specialties: ['OBGYN'],
        branch_name: 'Main',
        branch_address: '1 St',
        branch_city: 'Cairo',
        branch_governorate: 'Cairo',
      })
      .expect(201);
    mailMock.mockClear();
  }

  it('forgot → verify → reset succeeds; the same verified token cannot be replayed', async () => {
    await bootstrapUser();
    const http = app.getHttpServer();

    const forgot = await request(http)
      .post('/v1/auth/forgot-password')
      .send({ email: 'sara@example.com' })
      .expect(200);
    const unverifiedToken = forgot.body.data.reset_token as string;
    const otp = mailMock.mock.calls[0][1] as string;

    // Verify the OTP, get the verified reset token.
    const verified = await request(http)
      .post('/v1/auth/verify-reset-code')
      .send({ reset_token: unverifiedToken, code: otp })
      .expect(200);
    const verifiedToken = verified.body.data.reset_token as string;

    // The verified-token row exists.
    expect(await getTestPrisma().passwordResetToken.count()).toBe(1);

    // First reset succeeds.
    await request(http)
      .post('/v1/auth/reset-password')
      .send({
        reset_token: verifiedToken,
        password: NEW_PASSWORD,
        confirm_password: NEW_PASSWORD,
      })
      .expect(204);

    // The reset-token row is marked consumed.
    const row = await getTestPrisma().passwordResetToken.findFirstOrThrow();
    expect(row.consumed_at).not.toBeNull();

    // Second reset with the same token is rejected.
    await request(http)
      .post('/v1/auth/reset-password')
      .send({
        reset_token: verifiedToken,
        password: 'AttackerWanted1!',
        confirm_password: 'AttackerWanted1!',
      })
      .expect(401);

    // Login with the new password works; old password is rejected.
    await request(http)
      .post('/v1/auth/login')
      .send({ email: 'sara@example.com', password: NEW_PASSWORD })
      .expect(200);
    await request(http)
      .post('/v1/auth/login')
      .send({ email: 'sara@example.com', password: PASSWORD })
      .expect(401);
  });

  it('forgot-password on an unknown email returns the same shape; no audit/email is emitted', async () => {
    const http = app.getHttpServer();
    await request(http)
      .post('/v1/auth/forgot-password')
      .send({ email: 'ghost@example.com' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.reset_token).toEqual(expect.any(String));
        expect(res.body.data.reset_token.length).toBeGreaterThan(20);
        expect(res.body.data.expires_in).toBeGreaterThan(0);
      });
    // No email was dispatched.
    expect(mailMock).not.toHaveBeenCalled();
    // No PasswordResetToken row was written.
    expect(await getTestPrisma().passwordResetToken.count()).toBe(0);
  });
});
