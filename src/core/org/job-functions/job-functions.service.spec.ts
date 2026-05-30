import { JobFunctionsService } from './job-functions.service.js';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';

describe('JobFunctionsService', () => {
  it('returns the seeded job-function catalogue ordered by name', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { code: 'ANESTHESIOLOGIST', name: 'ANESTHESIOLOGIST', is_clinical: true },
      { code: 'NURSE', name: 'NURSE', is_clinical: true },
      { code: 'OBGYN', name: 'OBGYN', is_clinical: true },
      { code: 'RECEPTIONIST', name: 'RECEPTIONIST', is_clinical: false },
    ]);
    const prismaService = {
      db: { jobFunction: { findMany } },
    } as unknown as PrismaService;
    const service = new JobFunctionsService(prismaService);

    await expect(service.findLookup()).resolves.toEqual([
      { code: 'ANESTHESIOLOGIST', name: 'ANESTHESIOLOGIST', is_clinical: true },
      { code: 'NURSE', name: 'NURSE', is_clinical: true },
      { code: 'OBGYN', name: 'OBGYN', is_clinical: true },
      { code: 'RECEPTIONIST', name: 'RECEPTIONIST', is_clinical: false },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      select: { code: true, name: true, is_clinical: true },
      orderBy: { name: 'asc' },
    });
    expect(findMany.mock.calls[0][0]).not.toHaveProperty('where');
  });
});
