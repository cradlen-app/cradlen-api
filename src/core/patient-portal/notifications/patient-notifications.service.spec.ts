import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { PatientNotificationsService } from './patient-notifications.service.js';

describe('PatientNotificationsService', () => {
  let service: PatientNotificationsService;
  let findMany: jest.Mock;
  let count: jest.Mock;
  let updateMany: jest.Mock;
  let findFirst: jest.Mock;

  const ctx: PatientAuthContext = {
    userId: 'u1',
    guardianId: 'g1',
    accessiblePatientIds: ['p1', 'p2'],
  };

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([]);
    count = jest.fn().mockResolvedValue(0);
    updateMany = jest.fn().mockResolvedValue({ count: 1 });
    findFirst = jest.fn();
    const prisma = {
      db: {
        patientNotification: {
          findMany,
          count,
          updateMany,
          findFirst,
          create: jest.fn(),
        },
      },
    } as unknown as PrismaService;
    service = new PatientNotificationsService(prisma);
  });

  it('returns an empty page without querying when no accessible patients', async () => {
    const res = await service.list(
      { userId: 'u1', accessiblePatientIds: [] },
      1,
      20,
    );
    expect(findMany).not.toHaveBeenCalled();
    expect(res.items).toEqual([]);
    expect(res.meta).toMatchObject({ total: 0, unreadCount: 0 });
  });

  it('lists scoped to accessible patients, newest first, with an unread count', async () => {
    findMany.mockResolvedValue([
      {
        id: 'n1',
        category: 'medicine',
        title: 'New prescription',
        description: 'Your doctor prescribed new medication for you.',
        navigate_to: '/medications',
        is_read: false,
        read_at: null,
        metadata: { visitId: 'v1' },
        created_at: new Date(),
      },
    ]);
    count.mockResolvedValue(1);

    const res = await service.list(ctx, 1, 20, 'medicine');

    const arg = findMany.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.where).toMatchObject({
      patient_id: { in: ['p1', 'p2'] },
      is_deleted: false,
      category: 'medicine',
    });
    expect(arg.orderBy).toEqual({ created_at: 'desc' });
    expect(res.items[0].id).toBe('n1');
    expect(res.meta).toMatchObject({ total: 1, unreadCount: 1 });
  });

  it('markRead flips an owned unread row and returns it', async () => {
    findFirst.mockResolvedValue({
      id: 'n1',
      category: 'medicine',
      title: 'New prescription',
      description: 'd',
      navigate_to: null,
      is_read: true,
      read_at: new Date(),
      metadata: null,
      created_at: new Date(),
    });

    const res = await service.markRead('n1', ctx);

    const arg = updateMany.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.where).toMatchObject({
      id: 'n1',
      patient_id: { in: ['p1', 'p2'] },
      is_read: false,
    });
    expect(res.id).toBe('n1');
  });

  it('markRead throws 404 for a non-accessible / missing notification', async () => {
    findFirst.mockResolvedValue(null);
    await expect(service.markRead('n9', ctx)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
