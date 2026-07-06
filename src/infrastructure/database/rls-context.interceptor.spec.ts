import { of, lastValueFrom } from 'rxjs';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { RlsContextInterceptor } from './rls-context.interceptor.js';

function makeCtx(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const handler: CallHandler = { handle: () => of({ ok: true }) };

const STAFF = {
  userId: 'u-1',
  profileId: 'p-1',
  organizationId: 'org-1',
  role: 'OWNER',
  branchIds: ['b-1'],
};

function makeInterceptor(rlsEnabled: boolean, prisma: PrismaService) {
  return new RlsContextInterceptor({ url: 'x', rlsEnabled }, prisma);
}

describe('RlsContextInterceptor', () => {
  describe('buildContext', () => {
    const i = makeInterceptor(true, {} as PrismaService);

    it('maps a staff principal', () => {
      expect(i.buildContext(STAFF)).toEqual({
        actor: 'STAFF',
        orgId: 'org-1',
        profileId: 'p-1',
        role: 'OWNER',
        branchIds: ['b-1'],
      });
    });

    it('maps a platform admin to a bypass context', () => {
      expect(i.buildContext({ adminId: 'a-1' })).toEqual({
        actor: 'ADMIN',
        bypass: true,
      });
    });

    it('maps a patient principal', () => {
      expect(
        i.buildContext({ patientId: 'pat-1', accessiblePatientIds: ['pat-1'] }),
      ).toEqual({
        actor: 'PATIENT',
        patientId: 'pat-1',
        accessiblePatientIds: ['pat-1'],
      });
    });

    it('returns null for an unauthenticated request', () => {
      expect(i.buildContext(undefined)).toBeNull();
    });
  });

  it('is an immediate passthrough (no transaction) when RLS is disabled', async () => {
    const $transaction = jest.fn();
    const prisma = { baseClient: { $transaction } } as unknown as PrismaService;
    const i = makeInterceptor(false, prisma);

    const res = await lastValueFrom(i.intercept(makeCtx(STAFF), handler));

    expect($transaction).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true });
  });

  it('runs the request in a transaction and sets the RLS GUCs when enabled', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    const tx = { $queryRawUnsafe: queryRawUnsafe };
    const $transaction = jest.fn((cb: (t: typeof tx) => unknown) => cb(tx));
    const prisma = { baseClient: { $transaction } } as unknown as PrismaService;
    const i = makeInterceptor(true, prisma);

    const res = await lastValueFrom(i.intercept(makeCtx(STAFF), handler));

    expect($transaction).toHaveBeenCalledTimes(1);
    const [sql, bypass, orgId] = queryRawUnsafe.mock.calls[0];
    expect(String(sql)).toContain('set_config');
    expect(bypass).toBe('off');
    expect(orgId).toBe('org-1');
    expect(res).toEqual({ ok: true });
  });

  it('marks an admin transaction as bypass', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    const tx = { $queryRawUnsafe: queryRawUnsafe };
    const $transaction = jest.fn((cb: (t: typeof tx) => unknown) => cb(tx));
    const prisma = { baseClient: { $transaction } } as unknown as PrismaService;
    const i = makeInterceptor(true, prisma);

    await lastValueFrom(i.intercept(makeCtx({ adminId: 'a-1' }), handler));

    expect(queryRawUnsafe.mock.calls[0][1]).toBe('on'); // app.bypass
  });
});
