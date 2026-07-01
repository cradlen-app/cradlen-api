import type { ConfigType } from '@nestjs/config';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type pushConfig from '@config/push.config.js';

const mockSetVapidDetails = jest.fn();
const mockSendNotification = jest.fn();

jest.mock('web-push', () => ({
  __esModule: true,
  default: {
    setVapidDetails: (...args: unknown[]) => mockSetVapidDetails(...args),
    sendNotification: (...args: unknown[]) => mockSendNotification(...args),
  },
}));

import { PatientPushService } from './patient-push.service.js';

type PushConfig = ConfigType<typeof pushConfig>;

const enabledConfig: PushConfig = {
  enabled: true,
  subject: 'mailto:team@cradlen.com',
  publicKey: 'pub',
  privateKey: 'priv',
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

function webPushError(statusCode: number): Error {
  return Object.assign(new Error(`web-push ${statusCode}`), { statusCode });
}

/**
 * Prisma double. `patientGuardian.findMany` returns guardian links,
 * `patientAccount.findMany` returns accessible accounts, and
 * `patientPushSubscription.*` back the subscription reads/writes.
 */
function makePrisma(overrides?: {
  guardianLinks?: Array<{ guardian_id: string }>;
  accounts?: Array<{ id: string }>;
  subs?: Array<{ endpoint: string; p256dh: string; auth: string }>;
  upsert?: jest.Mock;
  subDeleteMany?: jest.Mock;
}) {
  const guardianFindMany = jest
    .fn()
    .mockResolvedValue(overrides?.guardianLinks ?? []);
  const accountFindMany = jest
    .fn()
    .mockResolvedValue(overrides?.accounts ?? []);
  const subFindMany = jest.fn().mockResolvedValue(overrides?.subs ?? []);
  const subDeleteMany =
    overrides?.subDeleteMany ?? jest.fn().mockResolvedValue({ count: 0 });
  const upsert = overrides?.upsert ?? jest.fn().mockResolvedValue(undefined);
  const prisma = {
    db: {
      patientGuardian: { findMany: guardianFindMany },
      patientAccount: { findMany: accountFindMany },
      patientPushSubscription: {
        findMany: subFindMany,
        deleteMany: subDeleteMany,
        upsert,
      },
    },
  } as unknown as PrismaService;
  return {
    prisma,
    guardianFindMany,
    accountFindMany,
    subFindMany,
    subDeleteMany,
    upsert,
  };
}

describe('PatientPushService', () => {
  beforeEach(() => {
    mockSetVapidDetails.mockReset();
    mockSendNotification.mockReset();
  });

  describe('onModuleInit', () => {
    it('configures VAPID when enabled', () => {
      const { prisma } = makePrisma();
      new PatientPushService(enabledConfig, prisma).onModuleInit();
      expect(mockSetVapidDetails).toHaveBeenCalledWith(
        'mailto:team@cradlen.com',
        'pub',
        'priv',
      );
    });

    it('stays inert (no DB, no throw) when disabled', () => {
      const { prisma, accountFindMany } = makePrisma();
      const service = new PatientPushService(
        { ...enabledConfig, enabled: false },
        prisma,
      );
      service.onModuleInit();
      expect(mockSetVapidDetails).not.toHaveBeenCalled();
      service.sendToPatient('patient-1', { title: 't', body: 'b' });
      expect(accountFindMany).not.toHaveBeenCalled();
    });

    it('boots and stays disabled when setVapidDetails throws', () => {
      mockSetVapidDetails.mockImplementation(() => {
        throw new Error('Vapid subject is not a url or mailto url');
      });
      const { prisma, accountFindMany } = makePrisma();
      const service = new PatientPushService(enabledConfig, prisma);
      expect(() => service.onModuleInit()).not.toThrow();
      service.sendToPatient('patient-1', { title: 't', body: 'b' });
      expect(accountFindMany).not.toHaveBeenCalled();
    });
  });

  describe('sendToPatient fan-out', () => {
    it('resolves the patient own account + guardian accounts and pushes to all their subs', async () => {
      const { prisma, guardianFindMany, accountFindMany, subFindMany } =
        makePrisma({
          guardianLinks: [{ guardian_id: 'g-1' }],
          accounts: [{ id: 'acc-self' }, { id: 'acc-guardian' }],
          subs: [
            { endpoint: 'e-1', p256dh: 'a', auth: 'b' },
            { endpoint: 'e-2', p256dh: 'a', auth: 'b' },
          ],
        });
      mockSendNotification.mockResolvedValue(undefined);
      const service = new PatientPushService(enabledConfig, prisma);
      service.onModuleInit();

      service.sendToPatient('patient-1', {
        title: 't',
        body: 'b',
        tag: 'n-1',
      });
      await flush();

      expect(guardianFindMany).toHaveBeenCalledWith({
        where: { patient_id: 'patient-1', is_deleted: false },
        select: { guardian_id: true },
      });
      expect(accountFindMany).toHaveBeenCalledWith({
        where: {
          is_active: true,
          is_deleted: false,
          OR: [{ patient_id: 'patient-1' }, { guardian_id: { in: ['g-1'] } }],
        },
        select: { id: true },
      });
      expect(subFindMany).toHaveBeenCalledWith({
        where: { account_id: { in: ['acc-self', 'acc-guardian'] } },
      });
      expect(mockSendNotification).toHaveBeenCalledTimes(2);
    });

    it('queries only the patient own account when there are no guardians', async () => {
      const { prisma, accountFindMany } = makePrisma({
        guardianLinks: [],
        accounts: [{ id: 'acc-self' }],
        subs: [],
      });
      const service = new PatientPushService(enabledConfig, prisma);
      service.onModuleInit();

      service.sendToPatient('patient-1', { title: 't', body: 'b' });
      await flush();

      expect(accountFindMany).toHaveBeenCalledWith({
        where: {
          is_active: true,
          is_deleted: false,
          OR: [{ patient_id: 'patient-1' }],
        },
        select: { id: true },
      });
    });

    it('prunes only 404/410 subscriptions', async () => {
      const { prisma, subDeleteMany } = makePrisma({
        accounts: [{ id: 'acc-self' }],
        subs: [
          { endpoint: 'e-ok', p256dh: 'a', auth: 'b' },
          { endpoint: 'e-gone', p256dh: 'a', auth: 'b' },
          { endpoint: 'e-5xx', p256dh: 'a', auth: 'b' },
        ],
      });
      mockSendNotification.mockImplementation((sub: { endpoint: string }) => {
        if (sub.endpoint === 'e-gone') return Promise.reject(webPushError(410));
        if (sub.endpoint === 'e-5xx') return Promise.reject(webPushError(500));
        return Promise.resolve();
      });
      const service = new PatientPushService(enabledConfig, prisma);
      service.onModuleInit();

      service.sendToPatient('patient-1', { title: 't', body: 'b' });
      await flush();

      expect(subDeleteMany).toHaveBeenCalledWith({
        where: { endpoint: { in: ['e-gone'] } },
      });
    });

    it('no-ops when no accessible account has a subscription', async () => {
      const { prisma } = makePrisma({
        accounts: [{ id: 'acc-self' }],
        subs: [],
      });
      const service = new PatientPushService(enabledConfig, prisma);
      service.onModuleInit();

      service.sendToPatient('patient-1', { title: 't', body: 'b' });
      await flush();

      expect(mockSendNotification).not.toHaveBeenCalled();
    });
  });

  describe('subscribe / unsubscribe', () => {
    it('upserts a subscription keyed by its unique endpoint', async () => {
      const { prisma, upsert } = makePrisma();
      await new PatientPushService(enabledConfig, prisma).subscribe(
        'acc-1',
        { endpoint: 'e-1', keys: { p256dh: 'a', auth: 'b' } },
        'UA/1.0',
      );
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { endpoint: 'e-1' } }),
      );
    });

    it('deletes only the endpoint owned by the caller (account-scoped)', async () => {
      const { prisma, subDeleteMany } = makePrisma();
      await new PatientPushService(enabledConfig, prisma).unsubscribe(
        'acc-1',
        'e-1',
      );
      expect(subDeleteMany).toHaveBeenCalledWith({
        where: { endpoint: 'e-1', account_id: 'acc-1' },
      });
    });
  });
});
