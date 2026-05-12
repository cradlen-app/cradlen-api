import {
  createParamDecorator,
  ExecutionContext,
  PreconditionFailedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ERROR_CODES } from '../constant/error-codes.js';

/**
 * Extracts the version token from the `If-Match` header.
 *
 * Expected header format: `If-Match: "version:N"` (RFC 9110 entity-tag style).
 * The value is treated as an opaque ETag, but we encode the row `version`
 * (Int) inside it so the server can verify the row hasn't moved since the
 * client read it.
 *
 * Throws 412 STALE_VERSION if the header is missing or malformed. Service
 * layer is responsible for comparing the returned number against the
 * loaded row's `version`.
 */
export const IfMatchVersion = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const raw = request.headers['if-match'];
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new PreconditionFailedException({
        code: ERROR_CODES.STALE_VERSION,
        message: 'If-Match header is required for this operation',
        details: { expected_format: '"version:<number>"' },
      });
    }
    const match = /^"?version:(\d+)"?$/.exec(raw.trim());
    if (!match) {
      throw new PreconditionFailedException({
        code: ERROR_CODES.STALE_VERSION,
        message: 'If-Match header is malformed',
        details: { received: raw, expected_format: '"version:<number>"' },
      });
    }
    return Number(match[1]);
  },
);

/**
 * Compare the version supplied via `If-Match` with the row's current
 * version. Throws 412 STALE_VERSION on mismatch with the current version
 * surfaced so the UI can prompt the user to reload.
 */
export function assertVersionMatches(
  ifMatchVersion: number,
  currentVersion: number,
): void {
  if (ifMatchVersion !== currentVersion) {
    throw new PreconditionFailedException({
      code: ERROR_CODES.STALE_VERSION,
      message:
        'The record has changed since you opened it. Reload and re-apply your edits.',
      details: {
        current_version: currentVersion,
        provided_version: ifMatchVersion,
      },
    });
  }
}
