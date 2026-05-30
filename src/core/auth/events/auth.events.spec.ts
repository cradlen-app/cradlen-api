import * as bcrypt from 'bcryptjs';
import { createAuthTestEnv } from '../services/test-env.js';
import { AUTH_EVENTS } from './auth.events.js';

describe('Auth domain events', () => {
  it('emits auth.login.succeeded with user id and email on valid credentials', async () => {
    const { sessionsService, mocks, publish } = createAuthTestEnv();
    mocks.userFindFirst.mockResolvedValue({
      id: 'user-1',
      email: 'sara@example.com',
      password_hashed: await bcrypt.hash('Password1!', 12),
      is_active: true,
      registration_status: 'PENDING',
      onboarding_completed: false,
    });

    await sessionsService.login({
      email: 'sara@example.com',
      password: 'Password1!',
    });

    expect(publish).toHaveBeenCalledWith(
      AUTH_EVENTS.login.succeeded,
      expect.objectContaining({
        user_id: 'user-1',
        email: 'sara@example.com',
        at: expect.any(Date),
      }),
    );
  });

  it('emits auth.login.failed (not_found) when the email has no active user', async () => {
    const { sessionsService, mocks, publish } = createAuthTestEnv();
    mocks.userFindFirst.mockResolvedValue(null);

    await expect(
      sessionsService.login({
        email: 'ghost@example.com',
        password: 'whatever',
      }),
    ).rejects.toThrow();

    expect(publish).toHaveBeenCalledWith(
      AUTH_EVENTS.login.failed,
      expect.objectContaining({
        email: 'ghost@example.com',
        reason: 'not_found',
        at: expect.any(Date),
      }),
    );
  });

  it('emits auth.login.failed (invalid_credentials) when the password mismatches', async () => {
    const { sessionsService, mocks, publish } = createAuthTestEnv();
    mocks.userFindFirst.mockResolvedValue({
      id: 'user-1',
      email: 'sara@example.com',
      password_hashed: await bcrypt.hash('Password1!', 12),
      is_active: true,
      registration_status: 'PENDING',
      onboarding_completed: false,
    });

    await expect(
      sessionsService.login({
        email: 'sara@example.com',
        password: 'wrong',
      }),
    ).rejects.toThrow();

    expect(publish).toHaveBeenCalledWith(
      AUTH_EVENTS.login.failed,
      expect.objectContaining({
        email: 'sara@example.com',
        reason: 'invalid_credentials',
        at: expect.any(Date),
      }),
    );
  });

  it('does NOT emit auth.refresh.rotated when issueTokenPair runs without revokeJti', async () => {
    const { tokensService, mocks, prismaService, publish } =
      createAuthTestEnv();
    mocks.profileFindFirst.mockResolvedValue({ id: 'profile-1' });
    const refreshTokenCreate = jest.fn().mockResolvedValue({});
    const $transaction = jest.fn(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          refreshToken: {
            updateMany: jest.fn(),
            create: refreshTokenCreate,
          },
        }),
    );
    (prismaService.db as unknown as { $transaction: jest.Mock }).$transaction =
      $transaction;

    await tokensService.issueTokenPair({
      user: { id: 'user-1' },
      profileId: 'profile-1',
      organizationId: 'org-1',
    });

    const rotationCalls = publish.mock.calls.filter(
      ([eventName]) => eventName === AUTH_EVENTS.refresh.rotated,
    );
    expect(rotationCalls).toHaveLength(0);
  });

  it('emits auth.signup.completed after a successful onboarding transaction', async () => {
    const txMock = {
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      organization: {
        create: jest.fn().mockResolvedValue({ id: 'org-new' }),
      },
      branch: { create: jest.fn().mockResolvedValue({}) },
      profile: {
        create: jest.fn().mockResolvedValue({ id: 'profile-new' }),
      },
      subscription: { create: jest.fn().mockResolvedValue({}) },
    };
    const { signupService, jwtService, publish, prismaService } =
      createAuthTestEnv({
        $transaction: jest
          .fn()
          .mockImplementation(
            async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock),
          ),
        user: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'user-1',
            email: 'sara@example.com',
            registration_status: 'ACTIVE',
            verified_at: new Date(),
            onboarding_completed: false,
            is_active: true,
          }),
          updateMany: jest.fn(),
        },
        role: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'role-owner', name: 'OWNER' }),
        },
        subscriptionPlan: {
          findUnique: jest.fn().mockResolvedValue({ id: 'plan-trial' }),
        },
        jobFunction: { findMany: jest.fn().mockResolvedValue([]) },
        specialty: { findMany: jest.fn().mockResolvedValue([]) },
      });

    // buildProfileSelectionResponse runs after the onboarding commit; let
    // it find an empty profile set so the call completes cleanly.
    (
      prismaService.db as unknown as {
        profile: { findMany: jest.Mock };
      }
    ).profile.findMany = jest.fn().mockResolvedValue([]);

    const signupToken = jwtService.sign(
      { userId: 'user-1', type: 'signup' },
      { secret: 'access-secret' },
    );

    await signupService.complete({
      signup_token: signupToken,
      organization_name: 'Clinic',
      specialties: [],
      branch_name: 'Main',
      branch_address: '1 St',
      branch_city: 'Cairo',
      branch_governorate: 'Cairo',
    });

    expect(publish).toHaveBeenCalledWith(
      AUTH_EVENTS.signup.completed,
      expect.objectContaining({
        user_id: 'user-1',
        organization_id: 'org-new',
        profile_id: 'profile-new',
        email: 'sara@example.com',
        completed_at: expect.any(Date),
      }),
    );
  });

  it('emits auth.password_reset.completed after a successful reset', async () => {
    const { passwordResetService, jwtService, publish, prismaService } =
      createAuthTestEnv();
    const userUpdate = jest.fn().mockResolvedValue({});
    const refreshTokenUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const $transaction = jest.fn(async (ops: unknown[]) => Promise.all(ops));
    (
      prismaService.db as unknown as {
        $transaction: jest.Mock;
        user: { update: jest.Mock };
        refreshToken: { updateMany: jest.Mock };
      }
    ).$transaction = $transaction;
    prismaService.db.user.update = userUpdate;
    prismaService.db.refreshToken.updateMany = refreshTokenUpdateMany;

    const resetToken = jwtService.sign(
      {
        userId: 'user-1',
        target: 'sara@example.com',
        jti: 'reset-jti',
        type: 'password_reset',
        verified: true,
      },
      { secret: 'reset-secret' },
    );

    await passwordResetService.reset({
      reset_token: resetToken,
      password: 'NewPassword1!',
      confirm_password: 'NewPassword1!',
    });

    expect(publish).toHaveBeenCalledWith(
      AUTH_EVENTS.passwordReset.completed,
      expect.objectContaining({
        user_id: 'user-1',
        target: 'sara@example.com',
        completed_at: expect.any(Date),
      }),
    );
  });
});
