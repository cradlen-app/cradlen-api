import type { ConfigType } from '@nestjs/config';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type pushConfig from '@config/push.config.js';

const mockSetVapidDetails = jest.fn();
const mockSendNotification = jest.fn();

// web-push is a CJS default import in the service; expose it as the ESM default.
jest.mock('web-push', () => ({
  __esModule: true,
  default: {
    setVapidDetails: (...args: unknown[]) => mockSetVapidDetails(...args),
    sendNotification: (...args: unknown[]) => mockSendNotification(...args),
  },
}));

// Imported after the mock so the module-level `import webpush from 'web-push'`
// resolves to the stub.
import { PushService } from './push.service.js';

type PushConfig = ConfigType<typeof pushConfig>;

const enabledConfig: PushConfig = {
  enabled: true,
  subject: 'mailto:team@cradlen.com',
  publicKey: 'pub',
  privateKey: 'priv',
};

// Drains the microtask queue so a fire-and-forget dispatch() settles before we
// assert on it. sendToProfile returns void and schedules dispatch off-thread.
const flush = () => new Promise((resolve) => setImmediate(resolve));

function makePrisma(overrides?: {
  findMany?: jest.Mock;
  deleteMany?: jest.Mock;
  upsert?: jest.Mock;
}) {
  const findMany = overrides?.findMany ?? jest.fn().mockResolvedValue([]);
  const deleteMany =
    overrides?.deleteMany ?? jest.fn().mockResolvedValue({ count: 0 });
  const upsert = overrides?.upsert ?? jest.fn().mockResolvedValue(undefined);
  const prisma = {
    db: { pushSubscription: { findMany, deleteMany, upsert } },
  } as unknown as PrismaService;
  return { prisma, findMany, deleteMany, upsert };
}

describe('PushService', () => {
  beforeEach(() => {
    // clearMocks only clears calls, not implementations set within a test.
    mockSetVapidDetails.mockReset();
    mockSendNotification.mockReset();
  });

  describe('onModuleInit', () => {
    it('configures VAPID when the config is enabled', () => {
      const { prisma } = makePrisma();
      new PushService(enabledConfig, prisma).onModuleInit();
      expect(mockSetVapidDetails).toHaveBeenCalledWith(
        'mailto:team@cradlen.com',
        'pub',
        'priv',
      );
    });

    it('never touches web-push when the config is disabled', () => {
      const { prisma, findMany } = makePrisma();
      const service = new PushService(
        { ...enabledConfig, enabled: false },
        prisma,
      );
      service.onModuleInit();
      expect(mockSetVapidDetails).not.toHaveBeenCalled();
      // Stays disabled: fan-out is a no-op (never hits the DB).
      service.sendToProfile('profile-1', { title: 't', body: 'b' });
      expect(findMany).not.toHaveBeenCalled();
    });

    it('boots (does not throw) and stays disabled when setVapidDetails throws', () => {
      // The 2026-06-30 incident shape: a bad subject/key throws at boot.
      mockSetVapidDetails.mockImplementation(() => {
        throw new Error('Vapid subject is not a url or mailto url');
      });
      const { prisma, findMany } = makePrisma();
      const service = new PushService(enabledConfig, prisma);

      expect(() => service.onModuleInit()).not.toThrow();

      service.sendToProfile('profile-1', { title: 't', body: 'b' });
      expect(findMany).not.toHaveBeenCalled();
    });
  });

  describe('dispatch (via sendToProfile)', () => {
    it('sends to every device and prunes only 404/410 subscriptions', async () => {
      const subs = [
        { endpoint: 'e-ok', p256dh: 'a', auth: 'b' },
        { endpoint: 'e-gone', p256dh: 'a', auth: 'b' },
        { endpoint: 'e-missing', p256dh: 'a', auth: 'b' },
      ];
      const { prisma, deleteMany } = makePrisma({
        findMany: jest.fn().mockResolvedValue(subs),
      });
      mockSendNotification.mockImplementation((sub: { endpoint: string }) => {
        if (sub.endpoint === 'e-gone')
          return Promise.reject({ statusCode: 410 });
        if (sub.endpoint === 'e-missing')
          return Promise.reject({ statusCode: 404 });
        return Promise.resolve();
      });
      const service = new PushService(enabledConfig, prisma);
      service.onModuleInit();

      service.sendToProfile('profile-1', { title: 't', body: 'b', tag: 'n-1' });
      await flush();

      expect(mockSendNotification).toHaveBeenCalledTimes(3);
      expect(deleteMany).toHaveBeenCalledWith({
        where: { endpoint: { in: ['e-gone', 'e-missing'] } },
      });
    });

    it('keeps subscriptions on a transient (5xx) send failure', async () => {
      const { prisma, deleteMany } = makePrisma({
        findMany: jest
          .fn()
          .mockResolvedValue([{ endpoint: 'e-1', p256dh: 'a', auth: 'b' }]),
      });
      mockSendNotification.mockRejectedValue({ statusCode: 500 });
      const service = new PushService(enabledConfig, prisma);
      service.onModuleInit();

      service.sendToProfile('profile-1', { title: 't', body: 'b' });
      await flush();

      expect(deleteMany).not.toHaveBeenCalled();
    });

    it('no-ops when the profile has no subscriptions', async () => {
      const { prisma } = makePrisma({
        findMany: jest.fn().mockResolvedValue([]),
      });
      const service = new PushService(enabledConfig, prisma);
      service.onModuleInit();

      service.sendToProfile('profile-1', { title: 't', body: 'b' });
      await flush();

      expect(mockSendNotification).not.toHaveBeenCalled();
    });
  });

  describe('subscribe / unsubscribe', () => {
    it('upserts a subscription keyed by its unique endpoint', async () => {
      const { prisma, upsert } = makePrisma();
      await new PushService(enabledConfig, prisma).subscribe(
        'profile-1',
        { endpoint: 'e-1', keys: { p256dh: 'a', auth: 'b' } },
        'UA/1.0',
      );
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { endpoint: 'e-1' } }),
      );
    });

    it('deletes only the endpoint owned by the caller (scoped)', async () => {
      const { prisma, deleteMany } = makePrisma();
      await new PushService(enabledConfig, prisma).unsubscribe(
        'profile-1',
        'e-1',
      );
      expect(deleteMany).toHaveBeenCalledWith({
        where: { endpoint: 'e-1', profile_id: 'profile-1' },
      });
    });
  });
});
