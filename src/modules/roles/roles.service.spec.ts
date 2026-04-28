import { Test } from '@nestjs/testing';
import { RolesService } from './roles.service';
import { PrismaService } from '../../database/prisma.service';
import { StaffService } from '../staff/staff.service.js';

describe('RolesService', () => {
  let service: RolesService;
  let prismaMock: { db: { role: { findMany: jest.Mock } } };
  let staffServiceMock: { assertOwner: jest.Mock };

  beforeEach(async () => {
    prismaMock = {
      db: {
        role: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'role-uuid-owner', name: 'owner' },
            { id: 'role-uuid-doctor', name: 'doctor' },
          ]),
        },
      },
    };
    staffServiceMock = {
      assertOwner: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: StaffService, useValue: staffServiceMock },
      ],
    }).compile();

    service = module.get(RolesService);
  });

  it('validates branch access when branch_id is provided', async () => {
    await service.listRoles('owner-uuid-1', 'org-uuid-1', 'branch-uuid-1');

    expect(staffServiceMock.assertOwner).toHaveBeenCalledWith(
      'owner-uuid-1',
      'org-uuid-1',
      'branch-uuid-1',
    );
    expect(prismaMock.db.role.findMany).toHaveBeenCalledWith({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  });

  it('keeps organization-scoped role listing when branch_id is omitted', async () => {
    await service.listRoles('owner-uuid-1', 'org-uuid-1');

    expect(staffServiceMock.assertOwner).toHaveBeenCalledWith(
      'owner-uuid-1',
      'org-uuid-1',
      undefined,
    );
  });
});
