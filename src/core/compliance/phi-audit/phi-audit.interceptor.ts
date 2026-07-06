import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import {
  AUDITS_PHI_ACCESS_KEY,
  type AuditsPhiAccessOptions,
} from '@common/decorators/audits-phi-access.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import {
  PhiAuditService,
  type RecordPhiAccessInput,
} from './phi-audit.service.js';

function isStaffContext(user: unknown): user is AuthContext {
  return (
    typeof user === 'object' &&
    user !== null &&
    'profileId' in user &&
    'organizationId' in user
  );
}

function isPatientContext(user: unknown): user is PatientAuthContext {
  return (
    typeof user === 'object' &&
    user !== null &&
    'accountId' in user &&
    'accessiblePatientIds' in user
  );
}

/**
 * Global interceptor that records a PHI read-access row for any handler carrying
 * `@AuditsPhiAccess(...)`. Undecorated handlers pass straight through. The audit
 * write runs on the success path only and is never awaited, so it can neither
 * block nor fail the response (a failed write is logged, not surfaced).
 */
@Injectable()
export class PhiAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PhiAuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly phiAuditService: PhiAuditService,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<
      AuditsPhiAccessOptions | undefined
    >(AUDITS_PHI_ACCESS_KEY, [context.getHandler(), context.getClass()]);
    if (!options) return next.handle();

    const request = context.switchToHttp().getRequest<Request>();
    const entry = this.buildEntry(request, options);

    return next.handle().pipe(
      tap({
        next: () => {
          if (!entry) return;
          void this.phiAuditService.record(entry).catch((err: unknown) => {
            this.logger.error({
              message: 'PHI access audit write failed',
              err,
            });
          });
        },
      }),
    );
  }

  private buildEntry(
    request: Request,
    options: AuditsPhiAccessOptions,
  ): RecordPhiAccessInput | null {
    const user = (request as Request & { user?: unknown }).user;

    const subject = this.resolveSubject(request, options, user);
    if (!subject) return null;

    const routePath =
      (request.route as { path?: string } | undefined)?.path ??
      request.originalUrl ??
      request.url;
    const headers = request.headers;
    const base = {
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      patientId: subject.patientId,
      resource: options.resource,
      route: `${request.method} ${routePath}`,
      purpose: options.purpose ?? null,
      requestId: (headers['x-request-id'] as string | undefined) ?? null,
      ip:
        (headers['x-forwarded-for'] as string | undefined) ??
        request.ip ??
        null,
    };

    if (isStaffContext(user)) {
      return {
        ...base,
        actorType: 'STAFF',
        userId: user.userId,
        profileId: user.profileId,
        organizationId: user.organizationId,
      };
    }
    if (isPatientContext(user)) {
      return {
        ...base,
        actorType: 'PATIENT',
        patientAccountId: user.accountId,
      };
    }
    return { ...base, actorType: 'SYSTEM' };
  }

  private resolveSubject(
    request: Request,
    options: AuditsPhiAccessOptions,
    user: unknown,
  ): {
    subjectType: 'PATIENT' | 'VISIT';
    subjectId: string;
    patientId: string | null;
  } | null {
    if (options.subject === 'self') {
      if (!isPatientContext(user)) return null;
      // A guardian selects a ward via ?patient_id=; honour it only when the
      // account may act on that patient. Otherwise fall back to the account's
      // own patient, or its sole ward.
      const q = request.query?.patient_id;
      const queryId = typeof q === 'string' ? q : undefined;
      const patientId =
        queryId && user.accessiblePatientIds.includes(queryId)
          ? queryId
          : (user.patientId ??
            (user.accessiblePatientIds.length === 1
              ? user.accessiblePatientIds[0]
              : undefined));
      if (!patientId) return null; // guardian with multiple wards, no selection
      return { subjectType: 'PATIENT', subjectId: patientId, patientId };
    }

    const paramName = options.param ?? 'id';
    const subjectId = request.params[paramName];
    if (typeof subjectId !== 'string' || subjectId.length === 0) return null;
    const subjectType = options.subjectType ?? 'PATIENT';
    return {
      subjectType,
      subjectId,
      patientId: subjectType === 'PATIENT' ? subjectId : null,
    };
  }
}
