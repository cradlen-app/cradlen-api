import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import type { Request } from 'express';
import { Observable, from, firstValueFrom } from 'rxjs';
import type { Prisma } from '@prisma/client';
import databaseConfig from '@config/database.config.js';
import { PrismaService } from './prisma.service.js';
import { rlsStorage, type RlsContext } from './rls-context.js';
import { createRlsTxProxy } from './rls-tx-proxy.js';

function isStaff(user: unknown): user is {
  userId: string;
  profileId: string;
  organizationId: string;
  role: string;
  branchIds: string[];
} {
  return (
    typeof user === 'object' &&
    user !== null &&
    'profileId' in user &&
    'organizationId' in user
  );
}

function isPatient(
  user: unknown,
): user is { patientId?: string; accessiblePatientIds: string[] } {
  return (
    typeof user === 'object' && user !== null && 'accessiblePatientIds' in user
  );
}

function isAdmin(user: unknown): user is { adminId: string } {
  return typeof user === 'object' && user !== null && 'adminId' in user;
}

/**
 * Binds an RLS session context to each request. Gated on `database.rlsEnabled`:
 *
 *  - OFF (default): immediate passthrough. No transaction, no context —
 *    `PrismaService.db` stays the base client. Zero behavior change.
 *  - ON: runs the whole request inside one interactive transaction, sets
 *    `set_config('app.*', …, true)` on it (transaction-scoped, so it survives
 *    the pooler), and stashes a flattening tx-proxy in AsyncLocalStorage so
 *    every downstream query runs on that connection.
 *
 * Enforcement is dormant until RLS policies are applied to tables (see
 * docs/security/rls-rollout.md) — this only positions the context.
 */
@Injectable()
export class RlsContextInterceptor implements NestInterceptor {
  private readonly enabled: boolean;

  constructor(
    @Inject(databaseConfig.KEY)
    config: ConfigType<typeof databaseConfig>,
    private readonly prismaService: PrismaService,
  ) {
    this.enabled = config.rlsEnabled;
  }

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    if (!this.enabled) return next.handle();

    const request = context.switchToHttp().getRequest<Request>();
    const ctx = this.buildContext(
      (request as Request & { user?: unknown }).user,
    );
    // No authenticated principal (public route) → no RLS transaction. Such routes
    // must not read tenant-scoped tables once policies are live.
    if (!ctx) return next.handle();

    return from(this.runInRlsTransaction(ctx, next));
  }

  private runInRlsTransaction(
    ctx: RlsContext,
    next: CallHandler<unknown>,
  ): Promise<unknown> {
    return this.prismaService.baseClient.$transaction(async (tx) => {
      await this.applyContext(tx, ctx);
      const proxy = createRlsTxProxy(tx);
      return rlsStorage.run({ ...ctx, tx: proxy }, () =>
        firstValueFrom(next.handle()),
      );
    });
  }

  /** Transaction-scoped GUCs the RLS policies read via `current_setting('app.*', true)`. */
  private applyContext(
    tx: Prisma.TransactionClient,
    ctx: RlsContext,
  ): Promise<unknown> {
    return tx.$queryRawUnsafe(
      `select
         set_config('app.bypass', $1, true),
         set_config('app.org_id', $2, true),
         set_config('app.profile_id', $3, true),
         set_config('app.role', $4, true),
         set_config('app.branch_ids', $5, true),
         set_config('app.patient_id', $6, true)`,
      ctx.bypass ? 'on' : 'off',
      ctx.orgId ?? '',
      ctx.profileId ?? '',
      ctx.role ?? '',
      (ctx.branchIds ?? []).join(','),
      ctx.patientId ?? '',
    );
  }

  /** Pure — maps a request principal to an RlsContext (null when unauthenticated). */
  buildContext(user: unknown): RlsContext | null {
    if (isStaff(user)) {
      return {
        actor: 'STAFF',
        orgId: user.organizationId,
        profileId: user.profileId,
        role: user.role,
        branchIds: user.branchIds,
      };
    }
    if (isAdmin(user)) {
      // Platform admin is cross-tenant — it carries its own authority.
      return { actor: 'ADMIN', bypass: true };
    }
    if (isPatient(user)) {
      return {
        actor: 'PATIENT',
        patientId: user.patientId,
        accessiblePatientIds: user.accessiblePatientIds,
      };
    }
    return null;
  }
}
