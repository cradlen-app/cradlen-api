import { RolesService } from './roles.service.js';
import type { AuthorizationService } from '../../common/authorization/authorization.service.js';
import type { PrismaService } from '../../database/prisma.service.js';

describe('RolesService', () => {
  it('asserts staff-management access before listing roles', async () => {
    const assertCanManageStaff = jest.fn().mockResolvedValue(undefined);
    const prismaService = {
      db: {
        role: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'role-id', name: 'OWNER' }]),
        },
      },
    } as unknown as PrismaService;
    const authorizationService = {
      assertCanManageStaff,
    } as unknown as AuthorizationService;
    const service = new RolesService(prismaService, authorizationService);

    await expect(
      service.listRoles('profile-id', 'account-id'),
    ).resolves.toEqual([{ id: 'role-id', name: 'OWNER' }]);
    expect(assertCanManageStaff).toHaveBeenCalledWith(
      'profile-id',
      'account-id',
    );
  });
});
