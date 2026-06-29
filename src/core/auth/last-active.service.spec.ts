import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { LastActiveService } from './last-active.service.js';

type UpdateArgs = {
  where: {
    id: string;
    OR: Array<{ last_active_at: null | { lt: Date } }>;
  };
  data: { last_active_at: Date };
};

describe('LastActiveService', () => {
  const makePrisma = (updateMany: jest.Mock) =>
    ({
      db: {
        user: { updateMany },
        patientAccount: { updateMany },
      },
    }) as unknown as PrismaService;

  it('stamps the entity with a once-per-UTC-day throttle clause', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = new LastActiveService(makePrisma(updateMany));

    await service.touchUser('user-1');

    expect(updateMany).toHaveBeenCalledTimes(1);
    const args = updateMany.mock.calls[0][0] as UpdateArgs;
    expect(args.where.id).toBe('user-1');
    // Throttle: only updates rows not yet stamped today (null or before today UTC).
    expect(args.where.OR).toEqual([
      { last_active_at: null },
      { last_active_at: { lt: expect.any(Date) } },
    ]);
    const startOfToday = args.where.OR[1].last_active_at as { lt: Date };
    expect(startOfToday.lt.getUTCHours()).toBe(0);
    expect(startOfToday.lt.getUTCMinutes()).toBe(0);
    expect(startOfToday.lt.getUTCSeconds()).toBe(0);
    expect(args.data.last_active_at).toBeInstanceOf(Date);
  });

  it('targets patient_accounts for portal touches', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = new LastActiveService(makePrisma(updateMany));

    await service.touchPatientAccount('acc-1');

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(
      (updateMany.mock.calls[0][0] as { where: { id: string } }).where.id,
    ).toBe('acc-1');
  });

  it('never throws into the auth path when the write fails', async () => {
    const updateMany = jest.fn().mockRejectedValue(new Error('db down'));
    const service = new LastActiveService(makePrisma(updateMany));

    await expect(service.touchUser('user-1')).resolves.toBeUndefined();
  });
});
