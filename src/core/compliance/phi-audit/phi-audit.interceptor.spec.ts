import { of, lastValueFrom } from 'rxjs';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PhiAuditInterceptor } from './phi-audit.interceptor.js';
import {
  PhiAuditService,
  type RecordPhiAccessInput,
} from './phi-audit.service.js';
import type { AuditsPhiAccessOptions } from '@common/decorators/audits-phi-access.decorator.js';

interface FakeRequest {
  method: string;
  url: string;
  params: Record<string, string>;
  query: Record<string, unknown>;
  headers: Record<string, string>;
  ip?: string;
  route?: { path?: string };
  user?: unknown;
}

function makeCtx(
  request: FakeRequest,
  metadata: AuditsPhiAccessOptions | undefined,
): { ctx: ExecutionContext; reflector: Reflector } {
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
  const reflector = {
    getAllAndOverride: () => metadata,
  } as unknown as Reflector;
  return { ctx, reflector };
}

function makeHandler(): CallHandler {
  return { handle: () => of({ ok: true }) };
}

const STAFF_USER = {
  userId: 'user-1',
  profileId: 'prof-1',
  organizationId: 'org-1',
  role: 'OWNER',
  jobFunction: null,
  branchIds: [],
};

describe('PhiAuditInterceptor', () => {
  let record: jest.Mock<Promise<void>, [RecordPhiAccessInput]>;
  let service: PhiAuditService;

  beforeEach(() => {
    record = jest.fn().mockResolvedValue(undefined);
    service = { record } as unknown as PhiAuditService;
  });

  it('passes through and records nothing when the handler is not annotated', async () => {
    const { ctx, reflector } = makeCtx(
      { method: 'GET', url: '/x', params: {}, query: {}, headers: {} },
      undefined,
    );
    const interceptor = new PhiAuditInterceptor(reflector, service);
    await lastValueFrom(interceptor.intercept(ctx, makeHandler()));
    expect(record).not.toHaveBeenCalled();
  });

  it('records a STAFF patient-detail read from the route param', async () => {
    const { ctx, reflector } = makeCtx(
      {
        method: 'GET',
        url: '/v1/patients/pat-1',
        params: { id: 'pat-1' },
        query: {},
        headers: { 'x-request-id': 'req-9' },
        route: { path: '/patients/:id' },
        user: STAFF_USER,
      },
      { resource: 'patient.detail', purpose: 'treatment' },
    );
    const interceptor = new PhiAuditInterceptor(reflector, service);
    await lastValueFrom(interceptor.intercept(ctx, makeHandler()));

    expect(record).toHaveBeenCalledTimes(1);
    const arg = record.mock.calls[0][0];
    expect(arg).toMatchObject({
      actorType: 'STAFF',
      userId: 'user-1',
      profileId: 'prof-1',
      organizationId: 'org-1',
      subjectType: 'PATIENT',
      subjectId: 'pat-1',
      patientId: 'pat-1',
      resource: 'patient.detail',
      purpose: 'treatment',
      requestId: 'req-9',
    });
  });

  it('records a VISIT subject with a null patient_id (resolved later)', async () => {
    const { ctx, reflector } = makeCtx(
      {
        method: 'GET',
        url: '/v1/visits/v-1/examination',
        params: { visitId: 'v-1' },
        query: {},
        headers: {},
        user: STAFF_USER,
      },
      { resource: 'visit.examination', param: 'visitId', subjectType: 'VISIT' },
    );
    const interceptor = new PhiAuditInterceptor(reflector, service);
    await lastValueFrom(interceptor.intercept(ctx, makeHandler()));

    const arg = record.mock.calls[0][0];
    expect(arg.subjectType).toBe('VISIT');
    expect(arg.subjectId).toBe('v-1');
    expect(arg.patientId).toBeNull();
  });

  it('records a PATIENT self-read from the portal token', async () => {
    const { ctx, reflector } = makeCtx(
      {
        method: 'GET',
        url: '/v1/patient-portal/journey',
        params: {},
        query: {},
        headers: {},
        user: {
          accountId: 'acc-1',
          patientId: 'pat-2',
          accessiblePatientIds: ['pat-2'],
        },
      },
      { resource: 'portal.journey', purpose: 'patient_self', subject: 'self' },
    );
    const interceptor = new PhiAuditInterceptor(reflector, service);
    await lastValueFrom(interceptor.intercept(ctx, makeHandler()));

    const arg = record.mock.calls[0][0];
    expect(arg).toMatchObject({
      actorType: 'PATIENT',
      patientAccountId: 'acc-1',
      subjectType: 'PATIENT',
      subjectId: 'pat-2',
      patientId: 'pat-2',
    });
  });

  it('honours a guardian ?patient_id= only when the ward is accessible', async () => {
    const { ctx, reflector } = makeCtx(
      {
        method: 'GET',
        url: '/v1/patient-portal/medications',
        params: {},
        query: { patient_id: 'ward-b' },
        headers: {},
        user: {
          accountId: 'acc-g',
          guardianId: 'g-1',
          accessiblePatientIds: ['ward-a', 'ward-b'],
        },
      },
      { resource: 'portal.medications', subject: 'self' },
    );
    const interceptor = new PhiAuditInterceptor(reflector, service);
    await lastValueFrom(interceptor.intercept(ctx, makeHandler()));

    expect(record.mock.calls[0][0].patientId).toBe('ward-b');
  });

  it('skips a guardian read that names an inaccessible ward', async () => {
    const { ctx, reflector } = makeCtx(
      {
        method: 'GET',
        url: '/v1/patient-portal/medications',
        params: {},
        query: { patient_id: 'not-mine' },
        headers: {},
        user: {
          accountId: 'acc-g',
          guardianId: 'g-1',
          accessiblePatientIds: ['ward-a', 'ward-b'],
        },
      },
      { resource: 'portal.medications', subject: 'self' },
    );
    const interceptor = new PhiAuditInterceptor(reflector, service);
    await lastValueFrom(interceptor.intercept(ctx, makeHandler()));

    expect(record).not.toHaveBeenCalled();
  });
});
