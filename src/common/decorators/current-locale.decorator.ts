import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Injects the resolved request locale (e.g. `'en'` | `'ar'`). The `main.ts`
 * middleware normalizes `Accept-Language` into the `x-locale` header against
 * `SUPPORTED_LOCALES`, falling back to `DEFAULT_LOCALE`, so this is always a
 * supported value.
 */
export const CurrentLocale = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const header = request.headers['x-locale'];
    const locale = Array.isArray(header) ? header[0] : header;
    return locale ?? 'en';
  },
);
