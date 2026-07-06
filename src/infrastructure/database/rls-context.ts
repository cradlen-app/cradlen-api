import { AsyncLocalStorage } from 'node:async_hooks';
import type { PrismaClient } from '@prisma/client';

/**
 * Per-request identity used to drive Postgres Row-Level-Security policies. Set by
 * `RlsContextInterceptor` (only when RLS is enabled) and read by the enforcement
 * layer to `set_config('app.*', …)` on the request's transaction.
 *
 * `bypass` marks a caller that is intentionally cross-tenant (platform admin) or
 * has no tenant (system/cron) — the enforcement layer skips the org restriction
 * for these (they carry their own authority).
 */
export interface RlsContext {
  actor: 'STAFF' | 'PATIENT' | 'ADMIN' | 'SYSTEM';
  orgId?: string;
  profileId?: string;
  role?: string;
  branchIds?: string[];
  patientId?: string;
  accessiblePatientIds?: string[];
  bypass?: boolean;
  /**
   * The request's RLS transaction, wrapped so nested `$transaction` calls flatten
   * into it (see rls-tx-proxy). `PrismaService.db` returns this when present, so
   * every query in the request runs on the connection where `set_config` was
   * applied. Only set while RLS is enabled.
   */
  tx?: PrismaClient;
}

export const rlsStorage = new AsyncLocalStorage<RlsContext>();

export function getRlsContext(): RlsContext | undefined {
  return rlsStorage.getStore();
}
