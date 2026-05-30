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

    const body = (req.body as Record<string, unknown> | undefined) ?? undefined;
    const identifier = body
      ? typeof body.email === 'string'
        ? body.email.toLowerCase()
        : typeof body.phone === 'string'
          ? body.phone
          : typeof body.phone_number === 'string'
            ? body.phone_number
            : typeof body.target === 'string'
              ? body.target.toLowerCase()
              : 'no-identifier'
      : 'no-identifier';

    return Promise.resolve(`${ip}:${identifier}`);
  }
}
