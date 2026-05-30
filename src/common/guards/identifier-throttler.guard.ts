import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Per-identifier throttle. Tracks by `${ip}:${email|phone|target}` so an
 * attacker rotating IPs cannot fan out a credential-stuffing run against
 * a single account. Applied alongside the global IP-only ThrottlerGuard,
 * so callers always face whichever bucket is tightest.
 *
 * For routes whose body has no identifier, the tracker falls back to
 * `${ip}:no-identifier` — effectively duplicating the global guard.
 * Mount this only on routes whose body carries an identifier.
 */
@Injectable()
export class IdentifierThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Request): Promise<string> {
    const ip =
      req.ip ??
      (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress ??
      'unknown-ip';

    const identifier = this.resolveIdentifier(
      req.body as Record<string, unknown> | undefined,
    );

    return Promise.resolve(`${ip}:${identifier}`);
  }

  /**
   * First identifier-bearing field wins, in priority order. Email and free-text
   * targets are lowercased so case variants share a bucket; phone numbers are
   * left verbatim. Falls back to `no-identifier` when the body carries none.
   */
  private resolveIdentifier(body: Record<string, unknown> | undefined): string {
    if (!body) return 'no-identifier';

    const lowerCased = new Set(['email', 'target']);
    for (const key of ['email', 'phone', 'phone_number', 'target']) {
      const value = body[key];
      if (typeof value === 'string') {
        return lowerCased.has(key) ? value.toLowerCase() : value;
      }
    }

    return 'no-identifier';
  }
}
