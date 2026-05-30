import { IdentifierThrottlerGuard } from './identifier-throttler.guard.js';
import type { Request } from 'express';

/**
 * Exposes the protected getTracker so we can pin its key-shape contract
 * without mounting the guard in a real Nest module.
 */
class TestableIdentifierThrottlerGuard extends IdentifierThrottlerGuard {
  public callGetTracker(req: Request): Promise<string> {
    return this.getTracker(req);
  }
}

function buildGuard() {
  return new TestableIdentifierThrottlerGuard(
    {} as never,
    {} as never,
    {} as never,
  );
}

function buildRequest(
  body: Record<string, unknown> | undefined,
  ip = '203.0.113.1',
): Request {
  return { ip, body } as unknown as Request;
}

describe('IdentifierThrottlerGuard.getTracker', () => {
  it('keys by ip + email when the body has an email', async () => {
    const guard = buildGuard();
    const key = await guard.callGetTracker(
      buildRequest({ email: 'Sara@Example.com', password: 'x' }),
    );
    // Email is lower-cased so case variations do not get their own bucket.
    expect(key).toBe('203.0.113.1:sara@example.com');
  });

  it('falls back to phone, then phone_number, then target', async () => {
    const guard = buildGuard();
    const phoneKey = await guard.callGetTracker(
      buildRequest({ phone: '+201012345678' }),
    );
    expect(phoneKey).toBe('203.0.113.1:+201012345678');

    const phoneNumberKey = await guard.callGetTracker(
      buildRequest({ phone_number: '+201012345679' }),
    );
    expect(phoneNumberKey).toBe('203.0.113.1:+201012345679');

    const targetKey = await guard.callGetTracker(
      buildRequest({ target: 'Sara@Example.com' }),
    );
    expect(targetKey).toBe('203.0.113.1:sara@example.com');
  });

  it('falls back to ip + no-identifier when no recognized field is present', async () => {
    const guard = buildGuard();
    const key = await guard.callGetTracker(buildRequest({ noise: 'x' }));
    expect(key).toBe('203.0.113.1:no-identifier');
  });

  it('falls back to ip + no-identifier when the body is missing', async () => {
    const guard = buildGuard();
    const key = await guard.callGetTracker(buildRequest(undefined));
    expect(key).toBe('203.0.113.1:no-identifier');
  });

  it('uses unknown-ip if the request has no resolvable address', async () => {
    const guard = buildGuard();
    const req = { body: { email: 'sara@example.com' } } as unknown as Request;
    const key = await guard.callGetTracker(req);
    expect(key).toBe('unknown-ip:sara@example.com');
  });
});
