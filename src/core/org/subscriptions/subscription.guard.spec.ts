import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionGuard } from './subscription.guard.js';
import { SubscriptionsService } from './subscriptions.service.js';

function buildContext(opts: {
  method: string;
  user?: { organizationId?: string };
  params?: Record<string, string>;
}): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        method: opts.method,
        user: opts.user,
        params: opts.params ?? {},
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('SubscriptionGuard', () => {
  let guard: SubscriptionGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let subscriptions: { isOrgActive: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    subscriptions = { isOrgActive: jest.fn() };
    guard = new SubscriptionGuard(
      reflector as unknown as Reflector,
      subscriptions as unknown as SubscriptionsService,
    );
  });

  it('passes GET requests without checking subscription', async () => {
    const ctx = buildContext({ method: 'GET', user: { organizationId: 'o1' } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(subscriptions.isOrgActive).not.toHaveBeenCalled();
  });

  it('passes when the route is marked @SkipSubscriptionCheck', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const ctx = buildContext({
      method: 'POST',
      user: { organizationId: 'o1' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(subscriptions.isOrgActive).not.toHaveBeenCalled();
  });

  it('passes writes when no org context (public/unauth)', async () => {
    const ctx = buildContext({ method: 'POST', user: undefined });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(subscriptions.isOrgActive).not.toHaveBeenCalled();
  });

  it('allows a write when the org subscription is active', async () => {
    subscriptions.isOrgActive.mockResolvedValue(true);
    const ctx = buildContext({
      method: 'POST',
      user: { organizationId: 'o1' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('blocks a write when the org subscription is not active', async () => {
    subscriptions.isOrgActive.mockResolvedValue(false);
    const ctx = buildContext({
      method: 'DELETE',
      user: { organizationId: 'o1' },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('gates the route :orgId when it matches the caller token org', async () => {
    subscriptions.isOrgActive.mockResolvedValue(true);
    const ctx = buildContext({
      method: 'POST',
      user: { organizationId: 'o1' },
      params: { orgId: 'o1' },
    });
    await guard.canActivate(ctx);
    expect(subscriptions.isOrgActive).toHaveBeenCalledWith('o1');
  });

  it('defers (does not probe) when route :orgId differs from the token org', async () => {
    const ctx = buildContext({
      method: 'POST',
      user: { organizationId: 'token-org' },
      params: { orgId: 'route-org' },
    });
    // A cross-tenant attempt: the guard must not reveal the foreign org's
    // subscription state — it returns true and leaves rejection to service authz.
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(subscriptions.isOrgActive).not.toHaveBeenCalled();
  });
});
