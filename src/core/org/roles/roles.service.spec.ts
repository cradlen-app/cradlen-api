import { RolesService } from './roles.service.js';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';

describe('RolesService', () => {
  it('returns the seeded role catalogue ordered by name', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'role-id-1', code: 'BRANCH_MANAGER', name: 'BRANCH_MANAGER' },
      { id: 'role-id-2', code: 'OWNER', name: 'OWNER' },
    ]);
    const prismaService = {
      db: { role: { findMany } },
    } as unknown as PrismaService;
    const service = new RolesService(prismaService);

    await expect(service.findLookup()).resolves.toEqual([
      { id: 'role-id-1', code: 'BRANCH_MANAGER', name: 'BRANCH_MANAGER' },
      { id: 'role-id-2', code: 'OWNER', name: 'OWNER' },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
  });
});
