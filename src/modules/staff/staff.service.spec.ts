import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { StaffService } from './staff.service';
import { PrismaService } from '../../database/prisma.service';
import { AuthorizationService } from '../../common/authorization/authorization.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

const mockStaffProfile = {
  id: 'prof-uuid',
  user_id: 'user-uuid',
  executive_title: null,
  engagement_type: 'FULL_TIME',
  user: {
    id: 'user-uuid',
    first_name: 'Ahmed',
    last_name: 'Ali',
    email: 'ahmed@cradlen.com',
    phone_number: '+201234567890',
  },
  roles: [{ role: { id: 'role-uuid', name: 'STAFF' } }],
  branches: [
    {
      branch: {
        id: 'branch-uuid',
        name: 'Main Branch',
        city: 'Cairo',
        governorate: 'Cairo',
      },
    },
  ],
  job_functions: [
    {
      job_function: {
        id: 'jf-uuid',
        code: 'OBGYN',
        name: 'OB/GYN',
        is_clinical: true,
      },
    },
  ],
  specialty_links: [
    { specialty: { id: 'spec-uuid', code: 'GYN', name: 'Gynecology' } },
  ],
  workingSchedules: [],
};

describe('StaffService.listStaff', () => {
  let service: StaffService;
  let db: {
    profile: { findMany: jest.Mock; count: jest.Mock };
  };
  let authMock: {
    assertCanViewStaff: jest.Mock;
    isOwner: jest.Mock;
    getEffectiveBranchIds: jest.Mock;
  };

  beforeEach(async () => {
    db = {
      profile: {
        findMany: jest.fn().mockResolvedValue([mockStaffProfile]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    authMock = {
      assertCanViewStaff: jest.fn().mockResolvedValue(undefined),
      isOwner: jest.fn().mockResolvedValue(true),
      getEffectiveBranchIds: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffService,
        { provide: PrismaService, useValue: { db } },
        { provide: AuthorizationService, useValue: authMock },
        {
          provide: SubscriptionsService,
          useValue: { assertStaffLimit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<StaffService>(StaffService);
  });

  it('returns paginated staff when no role filter is given', async () => {
    const result = await service.listStaff('caller-uuid', 'org-uuid');
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ roles: expect.anything() }),
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.meta).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('adds role filter to where clause when role is provided', async () => {
    await service.listStaff('caller-uuid', 'org-uuid', undefined, 'STAFF');
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          roles: { some: { role: { name: 'STAFF' } } },
        }),
      }),
    );
  });

  it('normalises role to uppercase', async () => {
    await service.listStaff('caller-uuid', 'org-uuid', undefined, 'staff');
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          roles: { some: { role: { name: 'STAFF' } } },
        }),
      }),
    );
  });

  it('throws ForbiddenException when caller lacks viewer role', async () => {
    authMock.assertCanViewStaff.mockRejectedValue(new ForbiddenException());
    await expect(service.listStaff('caller-uuid', 'org-uuid')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('applies both branchId and role filters together', async () => {
    await service.listStaff('caller-uuid', 'org-uuid', 'branch-uuid', 'STAFF');
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          branches: { some: { branch_id: 'branch-uuid' } },
          roles: { some: { role: { name: 'STAFF' } } },
        }),
      }),
    );
  });

  it('throws BadRequestException for an unknown role', async () => {
    await expect(
      service.listStaff('caller-uuid', 'org-uuid', undefined, 'INVALID'),
    ).rejects.toThrow(BadRequestException);
  });

  it('adds EXTERNAL role filter to where clause', async () => {
    await service.listStaff('caller-uuid', 'org-uuid', undefined, 'EXTERNAL');
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          roles: { some: { role: { name: 'EXTERNAL' } } },
        }),
      }),
    );
  });

  it('applies pagination skip/take and returns meta', async () => {
    db.profile.count.mockResolvedValue(45);
    const result = await service.listStaff(
      'caller-uuid',
      'org-uuid',
      undefined,
      undefined,
      3,
      10,
    );
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
    expect(result.meta).toEqual({
      page: 3,
      limit: 10,
      total: 45,
      totalPages: 5,
    });
  });
});
