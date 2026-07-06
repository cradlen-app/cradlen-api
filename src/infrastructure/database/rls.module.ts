import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RlsContextInterceptor } from './rls-context.interceptor.js';

/**
 * Registers the RLS session-context interceptor globally. Inert while
 * `RLS_ENABLED` is unset/false — see `RlsContextInterceptor`. Kept separate from
 * `DatabaseModule` so the interceptor can be rolled in/out independently.
 */
@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: RlsContextInterceptor }],
})
export class RlsModule {}
