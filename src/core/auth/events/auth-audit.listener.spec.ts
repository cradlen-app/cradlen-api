import { AuthAuditListener } from './auth-audit.listener.js';
import { AUTH_EVENTS } from './auth.events.js';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';

function buildListener(overrides: { create?: jest.Mock } = {}) {
  const authAuditCreate = overrides.create ?? jest.fn().mockResolvedValue({});
  const prismaService = {
    db: {
      authAuditLog: { create: authAuditCreate },
    },
  } as unknown as PrismaService;
  return {
    listener: new AuthAuditListener(prismaService),
    authAuditCreate,
  };
}

describe('AuthAuditListener', () => {
  it('writes a row on auth.signup.completed', async () => {
    const { listener, authAuditCreate } = buildListener();
    const completedAt = new Date();

    await listener.onSignupCompleted({
      user_id: 'user-1',
      organization_id: 'org-1',
      profile_id: 'profile-1',
      email: 'sara@example.com',
      completed_at: completedAt,
    });

    expect(authAuditCreate).toHaveBeenCalledWith({
      data: {
        event_name: AUTH_EVENTS.signup.completed,
        user_id: 'user-1',
        email: 'sara@example.com',
        payload: expect.objectContaining({
          user_id: 'user-1',
          organization_id: 'org-1',
        }),
        at: completedAt,
      },
    });
  });

  it('writes a row on auth.login.succeeded', async () => {
    const { listener, authAuditCreate } = buildListener();
    const at = new Date();

    await listener.onLoginSucceeded({
      user_id: 'user-1',
      email: 'sara@example.com',
      at,
    });

    expect(authAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_name: AUTH_EVENTS.login.succeeded,
        user_id: 'user-1',
        email: 'sara@example.com',
        at,
      }),
    });
  });

  it('writes a row on auth.login.failed with user_id intentionally null', async () => {
    const { listener, authAuditCreate } = buildListener();
    const at = new Date();

    await listener.onLoginFailed({
      email: 'ghost@example.com',
      reason: 'not_found',
      at,
    });

    expect(authAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_name: AUTH_EVENTS.login.failed,
        user_id: null,
        email: 'ghost@example.com',
        at,
      }),
    });
  });

  it('writes a row on auth.password_reset.completed', async () => {
    const { listener, authAuditCreate } = buildListener();
    const completedAt = new Date();

    await listener.onPasswordResetCompleted({
      user_id: 'user-1',
      target: 'sara@example.com',
      completed_at: completedAt,
    });

    expect(authAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_name: AUTH_EVENTS.passwordReset.completed,
        user_id: 'user-1',
        email: 'sara@example.com',
        at: completedAt,
      }),
    });
  });

  it('writes a row on auth.refresh.rotated', async () => {
    const { listener, authAuditCreate } = buildListener();
    const rotatedAt = new Date();

    await listener.onRefreshRotated({
      user_id: 'user-1',
      profile_id: 'profile-1',
      organization_id: 'org-1',
      old_jti: 'jti-old',
      new_jti: 'jti-new',
      rotated_at: rotatedAt,
    });

    expect(authAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_name: AUTH_EVENTS.refresh.rotated,
        user_id: 'user-1',
        email: null,
        at: rotatedAt,
      }),
    });
  });

  it('swallows a write failure and logs without throwing so the request flow is not affected', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db down'));
    const { listener } = buildListener({ create });

    await expect(
      listener.onLoginSucceeded({
        user_id: 'user-1',
        email: 'sara@example.com',
        at: new Date(),
      }),
    ).resolves.toBeUndefined();
  });
});
