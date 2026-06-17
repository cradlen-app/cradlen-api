import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { StaffService } from './staff.service';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthorizationService } from '@core/auth/authorization/authorization.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { StorageService } from '@infrastructure/storage/storage.service';

const ORG = 'org-uuid';
const BRANCH = 'branch-uuid';

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
  role: { id: 'role-uuid', name: 'STAFF' },
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
  job_function: {
    id: 'jf-uuid',
    code: 'OBGYN',
    name: 'OB/GYN',
    is_clinical: true,
  },
  specialty: { id: 'spec-uuid', code: 'OBGYN', name: 'Gynecology' },
  subspecialty_links: [
    { subspecialty: { id: 'sub-uuid', code: 'REI', name: 'Infertility' } },
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
    assertCanAccessBranch: jest.Mock;
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
      assertCanAccessBranch: jest.fn().mockResolvedValue(undefined),
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
        {
          provide: StorageService,
          useValue: {
            createPresignedDownloadUrl: jest
              .fn()
              .mockResolvedValue('https://get.example/avatar'),
          },
        },
      ],
    }).compile();

    service = module.get<StaffService>(StaffService);
  });

  it('always scopes the query to the path branch', async () => {
    await service.listStaff('caller-uuid', ORG, BRANCH);
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          branches: { some: { branch_id: BRANCH } },
        }),
      }),
    );
  });

  it('returns paginated staff when no role filter is given', async () => {
    const result = await service.listStaff('caller-uuid', ORG, BRANCH);
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ role: expect.anything() }),
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.meta).toEqual({
      page: 1,
      limit: 11,
      total: 1,
      totalPages: 1,
    });
  });

  it('adds role filter to where clause when role is provided', async () => {
    await service.listStaff('caller-uuid', ORG, BRANCH, { role: 'STAFF' });
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: { code: 'STAFF' },
        }),
      }),
    );
  });

  it('normalises role to uppercase', async () => {
    await service.listStaff('caller-uuid', ORG, BRANCH, { role: 'staff' });
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: { code: 'STAFF' },
        }),
      }),
    );
  });

  it('throws ForbiddenException when caller lacks viewer role', async () => {
    authMock.assertCanViewStaff.mockRejectedValue(new ForbiddenException());
    await expect(service.listStaff('caller-uuid', ORG, BRANCH)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException when caller cannot access the branch', async () => {
    authMock.assertCanAccessBranch.mockRejectedValue(new ForbiddenException());
    await expect(service.listStaff('caller-uuid', ORG, BRANCH)).rejects.toThrow(
      ForbiddenException,
    );
    expect(db.profile.findMany).not.toHaveBeenCalled();
  });

  it('throws BadRequestException for an unknown role', async () => {
    await expect(
      service.listStaff('caller-uuid', ORG, BRANCH, { role: 'INVALID' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('adds BRANCH_MANAGER role filter to where clause', async () => {
    await service.listStaff('caller-uuid', ORG, BRANCH, {
      role: 'BRANCH_MANAGER',
    });
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: { code: 'BRANCH_MANAGER' },
        }),
      }),
    );
  });

  it('adds is_clinical job-function filter when clinical=true is passed', async () => {
    await service.listStaff('caller-uuid', ORG, BRANCH, { clinical: true });
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          job_function: { is_clinical: true },
        }),
      }),
    );
  });

  it('omits the clinical filter when clinical is undefined', async () => {
    await service.listStaff('caller-uuid', ORG, BRANCH);
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          job_function: expect.anything(),
        }),
      }),
    );
  });

  it('adds case-insensitive OR search across user name/email/phone', async () => {
    await service.listStaff('caller-uuid', ORG, BRANCH, { search: 'merfat' });
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user: {
            OR: [
              { first_name: { contains: 'merfat', mode: 'insensitive' } },
              { last_name: { contains: 'merfat', mode: 'insensitive' } },
              { email: { contains: 'merfat', mode: 'insensitive' } },
              { phone_number: { contains: 'merfat', mode: 'insensitive' } },
            ],
          },
        }),
      }),
    );
  });

  it('filters by job_function_codes when provided', async () => {
    await service.listStaff('caller-uuid', ORG, BRANCH, {
      job_function_codes: ['NURSE', 'RECEPTIONIST'],
    });
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          job_function: { code: { in: ['NURSE', 'RECEPTIONIST'] } },
        }),
      }),
    );
  });

  it('ANDs job_function_codes with clinical=true rather than overwriting', async () => {
    await service.listStaff('caller-uuid', ORG, BRANCH, {
      clinical: true,
      job_function_codes: ['NURSE'],
    });
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          job_function: {
            AND: [{ is_clinical: true }, { code: { in: ['NURSE'] } }],
          },
        }),
      }),
    );
  });

  it('applies engagement_type filter', async () => {
    await service.listStaff('caller-uuid', ORG, BRANCH, {
      engagement_type: 'ON_DEMAND' as never,
    });
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ engagement_type: 'ON_DEMAND' }),
      }),
    );
  });

  it('applies executive_title filter', async () => {
    await service.listStaff('caller-uuid', ORG, BRANCH, {
      executive_title: 'CEO' as never,
    });
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ executive_title: 'CEO' }),
      }),
    );
  });

  it('applies pagination skip/take and returns meta', async () => {
    db.profile.count.mockResolvedValue(45);
    const result = await service.listStaff('caller-uuid', ORG, BRANCH, {
      page: 3,
      limit: 10,
    });
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

describe('StaffService.removeStaffFromBranch', () => {
  let service: StaffService;
  let db: {
    profile: { findFirst: jest.Mock; update: jest.Mock };
    profileBranch: {
      findFirst: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    workingSchedule: { deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let authMock: { assertCanManageStaffOnBranches: jest.Mock };

  beforeEach(async () => {
    db = {
      profile: {
        findFirst: jest.fn().mockResolvedValue({ id: 'prof-uuid' }),
        update: jest.fn().mockResolvedValue({}),
      },
      profileBranch: {
        findFirst: jest.fn().mockResolvedValue({ id: 'link-uuid' }),
        delete: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(2),
      },
      workingSchedule: { deleteMany: jest.fn().mockResolvedValue({}) },
      // Run the transaction callback against the same db mock.
      $transaction: jest.fn().mockImplementation((cb) => cb(db)),
    };
    authMock = {
      assertCanManageStaffOnBranches: jest.fn().mockResolvedValue(undefined),
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
        {
          provide: StorageService,
          useValue: {
            createPresignedDownloadUrl: jest
              .fn()
              .mockResolvedValue('https://get.example/avatar'),
          },
        },
      ],
    }).compile();

    service = module.get<StaffService>(StaffService);
  });

  it('throws ForbiddenException when caller cannot manage the branch', async () => {
    authMock.assertCanManageStaffOnBranches.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(
      service.removeStaffFromBranch('caller-uuid', ORG, BRANCH, 'prof-uuid'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException when staff is not assigned to the branch', async () => {
    db.profileBranch.findFirst.mockResolvedValue(null);
    await expect(
      service.removeStaffFromBranch('caller-uuid', ORG, BRANCH, 'prof-uuid'),
    ).rejects.toThrow(NotFoundException);
  });

  it('unassigns from the branch and keeps the profile when other branches remain', async () => {
    db.profileBranch.count.mockResolvedValue(2);
    await service.removeStaffFromBranch(
      'caller-uuid',
      ORG,
      BRANCH,
      'prof-uuid',
    );
    expect(db.profileBranch.delete).toHaveBeenCalledWith({
      where: { id: 'link-uuid' },
    });
    expect(db.workingSchedule.deleteMany).toHaveBeenCalledWith({
      where: { profile_id: 'prof-uuid', branch_id: BRANCH },
    });
    expect(db.profile.update).not.toHaveBeenCalled();
  });

  it('soft-deletes the profile when removing the last branch', async () => {
    db.profileBranch.count.mockResolvedValue(1);
    await service.removeStaffFromBranch(
      'caller-uuid',
      ORG,
      BRANCH,
      'prof-uuid',
    );
    expect(db.profileBranch.delete).toHaveBeenCalled();
    expect(db.profile.update).toHaveBeenCalledWith({
      where: { id: 'prof-uuid' },
      data: expect.objectContaining({ is_deleted: true }),
    });
  });

  it('blocks removing yourself from your last branch', async () => {
    db.profileBranch.count.mockResolvedValue(1);
    await expect(
      service.removeStaffFromBranch('prof-uuid', ORG, BRANCH, 'prof-uuid'),
    ).rejects.toThrow(BadRequestException);
    expect(db.profileBranch.delete).not.toHaveBeenCalled();
  });
});

describe('StaffService.resetStaffPassword', () => {
  let service: StaffService;
  let db: {
    profile: { findFirst: jest.Mock };
    user: { update: jest.Mock };
    refreshToken: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let authMock: {
    assertCanManageStaffOnBranches: jest.Mock;
    assertCanManageStaffForTarget: jest.Mock;
    assertOwnerOnly: jest.Mock;
  };

  const DTO = { password: 'new-secret-pw' };

  beforeEach(async () => {
    db = {
      profile: {
        findFirst: jest.fn().mockResolvedValue({
          user_id: 'user-uuid',
          role: { name: 'STAFF' },
        }),
      },
      user: { update: jest.fn().mockResolvedValue({}) },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      $transaction: jest.fn().mockImplementation((cb) => cb(db)),
    };
    authMock = {
      assertCanManageStaffOnBranches: jest.fn().mockResolvedValue(undefined),
      assertCanManageStaffForTarget: jest.fn().mockResolvedValue(undefined),
      assertOwnerOnly: jest.fn().mockResolvedValue(undefined),
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
        {
          provide: StorageService,
          useValue: { createPresignedDownloadUrl: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<StaffService>(StaffService);
  });

  it('checks branch and target management authorization', async () => {
    await service.resetStaffPassword(
      'caller-uuid',
      ORG,
      BRANCH,
      'prof-uuid',
      DTO,
    );
    expect(authMock.assertCanManageStaffOnBranches).toHaveBeenCalledWith(
      'caller-uuid',
      ORG,
      [BRANCH],
    );
    expect(authMock.assertCanManageStaffForTarget).toHaveBeenCalledWith(
      'caller-uuid',
      ORG,
      'prof-uuid',
    );
  });

  it('throws NotFoundException when target is not in the branch/org', async () => {
    db.profile.findFirst.mockResolvedValue(null);
    await expect(
      service.resetStaffPassword('caller-uuid', ORG, BRANCH, 'prof-uuid', DTO),
    ).rejects.toThrow(NotFoundException);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('hashes the new password and revokes active sessions', async () => {
    await service.resetStaffPassword(
      'caller-uuid',
      ORG,
      BRANCH,
      'prof-uuid',
      DTO,
    );
    const updateArg = db.user.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'user-uuid' });
    expect(updateArg.data.password_hashed).toEqual(expect.any(String));
    expect(updateArg.data.password_hashed).not.toEqual(DTO.password);
    expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { user_id: 'user-uuid', is_revoked: false },
      data: { is_revoked: true },
    });
  });

  it('does not require OWNER for a plain STAFF target', async () => {
    await service.resetStaffPassword(
      'caller-uuid',
      ORG,
      BRANCH,
      'prof-uuid',
      DTO,
    );
    expect(authMock.assertOwnerOnly).not.toHaveBeenCalled();
  });

  it('requires OWNER to reset a privileged (BRANCH_MANAGER) target', async () => {
    db.profile.findFirst.mockResolvedValue({
      user_id: 'user-uuid',
      role: { name: 'BRANCH_MANAGER' },
    });
    authMock.assertOwnerOnly.mockRejectedValue(new ForbiddenException());
    await expect(
      service.resetStaffPassword('caller-uuid', ORG, BRANCH, 'prof-uuid', DTO),
    ).rejects.toThrow(ForbiddenException);
    expect(db.user.update).not.toHaveBeenCalled();
  });
});

describe('StaffService.getBranchStats', () => {
  let service: StaffService;
  let db: {
    profile: { count: jest.Mock; groupBy: jest.Mock };
    role: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let authMock: {
    assertCanViewStaff: jest.Mock;
    assertCanAccessBranch: jest.Mock;
  };

  // Two roles — proves the breakdown is discovered from data, not a fixed enum.
  const roles = [
    { id: 'role-staff', code: 'STAFF', name: 'Staff' },
    { id: 'role-ext', code: 'EXTERNAL', name: 'External' },
  ];

  beforeEach(async () => {
    db = {
      profile: {
        count: jest.fn(),
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { role_id: 'role-staff' },
            { role_id: 'role-ext' },
          ]),
      },
      role: { findMany: jest.fn().mockResolvedValue(roles) },
      $transaction: jest.fn(),
    };
    authMock = {
      assertCanViewStaff: jest.fn().mockResolvedValue(undefined),
      assertCanAccessBranch: jest.fn().mockResolvedValue(undefined),
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
        {
          provide: StorageService,
          useValue: { createPresignedDownloadUrl: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<StaffService>(StaffService);
  });

  it('asserts viewer role and branch access before computing stats', async () => {
    authMock.assertCanAccessBranch.mockRejectedValue(new ForbiddenException());
    await expect(
      service.getBranchStats('caller-uuid', ORG, BRANCH),
    ).rejects.toThrow(ForbiddenException);
    expect(db.profile.groupBy).not.toHaveBeenCalled();
  });

  it('returns total + clinical + a data-driven per-role breakdown, sorted desc', async () => {
    // [totalCur, totalPrev, clinicalCur, clinicalPrev, staff cur/prev, ext cur/prev]
    db.$transaction.mockResolvedValue([12, 9, 7, 6, 3, 2, 5, 4]);

    const result = await service.getBranchStats('caller-uuid', ORG, BRANCH);

    expect(result.total).toEqual({ current: 12, previous: 9 });
    expect(result.clinical).toEqual({ current: 7, previous: 6 });
    expect(result.by_role).toEqual([
      { role_code: 'EXTERNAL', role_name: 'External', current: 5, previous: 4 },
      { role_code: 'STAFF', role_name: 'Staff', current: 3, previous: 2 },
    ]);
  });

  it('scopes the previous snapshot to staff who joined the branch before the cutoff', async () => {
    db.$transaction.mockResolvedValue([1, 1, 0, 0, 1, 1]);
    db.profile.groupBy.mockResolvedValue([{ role_id: 'role-staff' }]);
    db.role.findMany.mockResolvedValue([roles[0]]);

    await service.getBranchStats('caller-uuid', ORG, BRANCH);

    // Count calls run in array order: [0]=total current, [1]=total previous.
    // The `previous` snapshot gates the branch join on a start-of-month cutoff.
    const currentTotalWhere = db.profile.count.mock.calls[0][0].where;
    const previousTotalWhere = db.profile.count.mock.calls[1][0].where;
    expect(currentTotalWhere.branches.some.created_at).toBeUndefined();
    expect(previousTotalWhere.branches.some.created_at.lte).toBeInstanceOf(
      Date,
    );
  });

  it('drops roles with a zero current count', async () => {
    db.$transaction.mockResolvedValue([4, 2, 1, 1, 4, 2, 0, 0]);
    const result = await service.getBranchStats('caller-uuid', ORG, BRANCH);
    expect(result.by_role).toHaveLength(1);
    expect(result.by_role[0].role_code).toBe('STAFF');
  });

  it('returns an empty breakdown when no roles are present', async () => {
    db.profile.groupBy.mockResolvedValue([]);
    db.$transaction.mockResolvedValue([0, 0, 0, 0]);
    const result = await service.getBranchStats('caller-uuid', ORG, BRANCH);
    expect(result.by_role).toEqual([]);
    expect(db.role.findMany).not.toHaveBeenCalled();
  });
});
