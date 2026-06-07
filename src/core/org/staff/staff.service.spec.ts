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
    { specialty: { id: 'spec-uuid', code: 'OBGYN', name: 'Gynecology' } },
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
        where: expect.not.objectContaining({ roles: expect.anything() }),
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
          roles: { some: { role: { code: 'STAFF' } } },
        }),
      }),
    );
  });

  it('normalises role to uppercase', async () => {
    await service.listStaff('caller-uuid', ORG, BRANCH, { role: 'staff' });
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          roles: { some: { role: { code: 'STAFF' } } },
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

  it('adds EXTERNAL role filter to where clause', async () => {
    await service.listStaff('caller-uuid', ORG, BRANCH, { role: 'EXTERNAL' });
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          roles: { some: { role: { code: 'EXTERNAL' } } },
        }),
      }),
    );
  });

  it('adds is_clinical job-function filter when clinical=true is passed', async () => {
    await service.listStaff('caller-uuid', ORG, BRANCH, { clinical: true });
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          job_functions: { some: { job_function: { is_clinical: true } } },
        }),
      }),
    );
  });

  it('omits the clinical filter when clinical is undefined', async () => {
    await service.listStaff('caller-uuid', ORG, BRANCH);
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          job_functions: expect.anything(),
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
          job_functions: {
            some: { job_function: { code: { in: ['NURSE', 'RECEPTIONIST'] } } },
          },
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
          AND: [
            {
              job_functions: {
                some: { job_function: { is_clinical: true } },
              },
            },
            {
              job_functions: {
                some: { job_function: { code: { in: ['NURSE'] } } },
              },
            },
          ],
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
