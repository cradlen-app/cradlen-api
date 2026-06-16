import { Test } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthorizationService } from './authorization.service';
import { PrismaService } from '@infrastructure/database/prisma.service';

describe('AuthorizationService.assertCanViewStaff', () => {
  let service: AuthorizationService;
  let profile: { findFirst: jest.Mock };

  beforeEach(async () => {
    profile = { findFirst: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        {
          provide: PrismaService,
          useValue: { db: { profile } },
        },
      ],
    }).compile();
    service = module.get(AuthorizationService);
  });

  it('allows OWNER (matched via roles)', async () => {
    profile.findFirst.mockResolvedValue({ id: 'p-owner' });
    await expect(
      service.assertCanViewStaff('prof-1', 'org-1'),
    ).resolves.toBeUndefined();
  });

  it('allows BRANCH_MANAGER (matched via roles)', async () => {
    profile.findFirst.mockResolvedValue({ id: 'p-mgr' });
    await expect(
      service.assertCanViewStaff('prof-2', 'org-1'),
    ).resolves.toBeUndefined();
  });

  it('allows a profile whose only matching credential is the RECEPTIONIST job_function', async () => {
    profile.findFirst.mockResolvedValue({ id: 'p-receptionist' });
    await expect(
      service.assertCanViewStaff('prof-3', 'org-1'),
    ).resolves.toBeUndefined();
  });

  it('queries with both role and job_function predicates in OR', async () => {
    profile.findFirst.mockResolvedValue({ id: 'any' });
    await service.assertCanViewStaff('prof-4', 'org-1');
    expect(profile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { role: { name: { in: ['OWNER', 'BRANCH_MANAGER'] } } },
            { job_function: { code: { in: ['RECEPTIONIST'] } } },
          ],
        }),
      }),
    );
  });

  it('throws ForbiddenException when neither role nor job_function matches', async () => {
    profile.findFirst.mockResolvedValue(null);
    await expect(service.assertCanViewStaff('prof-5', 'org-1')).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('AuthorizationService — per-branch staff management', () => {
  let service: AuthorizationService;
  let profile: { findFirst: jest.Mock };
  let profileBranch: { findMany: jest.Mock; findFirst: jest.Mock };
  let branch: { findMany: jest.Mock; findFirst: jest.Mock };
  let role: { findFirst: jest.Mock };

  const stubOwner = () => profile.findFirst.mockResolvedValue({ id: 'pr' });
  const stubBranchManager = () => {
    // First call: canManageStaff (returns OWNER or BRANCH_MANAGER row).
    // Second call: isOwner check (returns null — caller is not OWNER).
    profile.findFirst.mockResolvedValueOnce({ id: 'pr-mgr' });
    profile.findFirst.mockResolvedValueOnce(null);
  };
  const stubNoRole = () => profile.findFirst.mockResolvedValue(null);

  beforeEach(async () => {
    profile = { findFirst: jest.fn() };
    profileBranch = { findMany: jest.fn(), findFirst: jest.fn() };
    branch = { findMany: jest.fn(), findFirst: jest.fn() };
    role = { findFirst: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        {
          provide: PrismaService,
          useValue: {
            db: { profile, profileBranch, branch, role },
          },
        },
      ],
    }).compile();
    service = module.get(AuthorizationService);
  });

  describe('canManageStaffOnBranches', () => {
    it('allows OWNER for any branches without checking branch list', async () => {
      stubOwner();
      const result = await service.canManageStaffOnBranches('p', 'o', [
        'b-other',
      ]);
      expect(result).toBe(true);
      expect(profileBranch.findMany).not.toHaveBeenCalled();
    });

    it('allows BRANCH_MANAGER when branchIds ⊆ assigned branches', async () => {
      stubBranchManager();
      profileBranch.findMany.mockResolvedValue([
        { branch_id: 'b1' },
        { branch_id: 'b2' },
      ]);
      await expect(
        service.canManageStaffOnBranches('p', 'o', ['b1']),
      ).resolves.toBe(true);
    });

    it('rejects BRANCH_MANAGER when any requested branch is outside scope', async () => {
      stubBranchManager();
      profileBranch.findMany.mockResolvedValue([{ branch_id: 'b1' }]);
      await expect(
        service.canManageStaffOnBranches('p', 'o', ['b1', 'b-other']),
      ).resolves.toBe(false);
    });

    it('rejects when caller has no staff-management role', async () => {
      stubNoRole();
      await expect(
        service.canManageStaffOnBranches('p', 'o', ['b1']),
      ).resolves.toBe(false);
    });

    it('rejects when called with empty branchIds for non-OWNER', async () => {
      stubBranchManager();
      await expect(
        service.canManageStaffOnBranches('p', 'o', []),
      ).resolves.toBe(false);
    });
  });

  describe('canManageStaffForTarget', () => {
    it('allows OWNER for any target', async () => {
      stubOwner();
      await expect(
        service.canManageStaffForTarget('caller', 'org', 'target'),
      ).resolves.toBe(true);
    });

    it('allows BRANCH_MANAGER when caller and target share at least one branch', async () => {
      stubBranchManager();
      profileBranch.findMany
        .mockResolvedValueOnce([{ branch_id: 'b1' }, { branch_id: 'b2' }]) // caller
        .mockResolvedValueOnce([{ branch_id: 'b2' }, { branch_id: 'b3' }]); // target
      await expect(
        service.canManageStaffForTarget('caller', 'org', 'target'),
      ).resolves.toBe(true);
    });

    it('rejects BRANCH_MANAGER when caller and target share no branch', async () => {
      stubBranchManager();
      profileBranch.findMany
        .mockResolvedValueOnce([{ branch_id: 'b1' }])
        .mockResolvedValueOnce([{ branch_id: 'b2' }]);
      await expect(
        service.canManageStaffForTarget('caller', 'org', 'target'),
      ).resolves.toBe(false);
    });

    it('rejects when target has no branch assignments', async () => {
      stubBranchManager();
      profileBranch.findMany
        .mockResolvedValueOnce([{ branch_id: 'b1' }])
        .mockResolvedValueOnce([]);
      await expect(
        service.canManageStaffForTarget('caller', 'org', 'target'),
      ).resolves.toBe(false);
    });
  });

  describe('assertNoPrivilegedRoleAssignment', () => {
    it('allows any role when caller is OWNER', async () => {
      stubOwner();
      await expect(
        service.assertNoPrivilegedRoleAssignment('p', 'o', 'r1'),
      ).resolves.toBeUndefined();
      expect(role.findFirst).not.toHaveBeenCalled();
    });

    it('throws when non-OWNER tries to assign OWNER or BRANCH_MANAGER', async () => {
      stubNoRole();
      role.findFirst.mockResolvedValue({ code: 'BRANCH_MANAGER' });
      await expect(
        service.assertNoPrivilegedRoleAssignment('p', 'o', 'r1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows non-OWNER to assign a non-privileged role', async () => {
      stubNoRole();
      role.findFirst.mockResolvedValue(null);
      await expect(
        service.assertNoPrivilegedRoleAssignment('p', 'o', 'r1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('assertOwnerOnly', () => {
    it('passes for OWNER', async () => {
      stubOwner();
      await expect(service.assertOwnerOnly('p', 'o')).resolves.toBeUndefined();
    });

    it('throws for non-OWNER', async () => {
      stubNoRole();
      await expect(service.assertOwnerOnly('p', 'o')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});

describe('AuthorizationService.getProfileContext', () => {
  let service: AuthorizationService;
  let profile: { findFirst: jest.Mock };
  let branch: { findMany: jest.Mock };
  let profileBranch: { findMany: jest.Mock };

  beforeEach(async () => {
    profile = { findFirst: jest.fn() };
    branch = { findMany: jest.fn() };
    profileBranch = { findMany: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        {
          provide: PrismaService,
          useValue: { db: { profile, branch, profileBranch } },
        },
      ],
    }).compile();
    service = module.get(AuthorizationService);
  });

  it('resolves OWNER context in exactly 2 queries (profile + org branches)', async () => {
    profile.findFirst.mockResolvedValue({
      role: { code: 'OWNER', name: 'OWNER' },
      job_function: null,
    });
    branch.findMany.mockResolvedValue([{ id: 'b1' }, { id: 'b2' }]);

    const ctx = await service.getProfileContext('u', 'p', 'org', 'b1');

    expect(ctx).toEqual({
      userId: 'u',
      profileId: 'p',
      organizationId: 'org',
      activeBranchId: 'b1',
      role: 'OWNER',
      jobFunction: null,
      branchIds: ['b1', 'b2'],
    });
    expect(profile.findFirst).toHaveBeenCalledTimes(1);
    expect(branch.findMany).toHaveBeenCalledTimes(1);
    expect(profileBranch.findMany).not.toHaveBeenCalled();
  });

  it('resolves member context in exactly 2 queries (profile + profileBranch)', async () => {
    profile.findFirst.mockResolvedValue({
      role: { code: 'STAFF', name: 'STAFF' },
      job_function: { code: 'RECEPTIONIST' },
    });
    profileBranch.findMany.mockResolvedValue([
      { branch_id: 'b1' },
      { branch_id: 'b2' },
    ]);

    const ctx = await service.getProfileContext('u', 'p', 'org');

    expect(ctx.role).toEqual('STAFF');
    expect(ctx.jobFunction).toEqual('RECEPTIONIST');
    expect(ctx.branchIds).toEqual(['b1', 'b2']);
    expect(profile.findFirst).toHaveBeenCalledTimes(1);
    expect(profileBranch.findMany).toHaveBeenCalledTimes(1);
    expect(branch.findMany).not.toHaveBeenCalled();
  });

  it('filters on user.is_active and organization.status in the single profile query', async () => {
    profile.findFirst.mockResolvedValue({
      role: { code: 'OWNER', name: 'OWNER' },
      job_function: null,
    });
    branch.findMany.mockResolvedValue([]);

    await service.getProfileContext('u', 'p', 'org');

    expect(profile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'p',
          user_id: 'u',
          organization_id: 'org',
          is_active: true,
          is_deleted: false,
          user: { is_deleted: false, is_active: true },
          organization: { status: 'ACTIVE', is_deleted: false },
        }),
      }),
    );
  });

  it('rejects with UnauthorizedException when the merged query returns nothing', async () => {
    profile.findFirst.mockResolvedValue(null);

    await expect(service.getProfileContext('u', 'p', 'org')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(branch.findMany).not.toHaveBeenCalled();
    expect(profileBranch.findMany).not.toHaveBeenCalled();
  });
});

describe('AuthorizationService.isClinical', () => {
  let service: AuthorizationService;
  let profile: { findFirst: jest.Mock };

  beforeEach(async () => {
    profile = { findFirst: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        {
          provide: PrismaService,
          useValue: { db: { profile } },
        },
      ],
    }).compile();
    service = module.get(AuthorizationService);
  });

  it('returns true when a clinical job function exists', async () => {
    profile.findFirst.mockResolvedValue({ id: 'pjf-1' });
    await expect(service.isClinical('prof-1')).resolves.toBe(true);
    expect(profile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'prof-1',
          job_function: { is_clinical: true },
        },
      }),
    );
  });

  it('returns false when the profile has no clinical job function', async () => {
    profile.findFirst.mockResolvedValue(null);
    await expect(service.isClinical('prof-1')).resolves.toBe(false);
  });
});

describe('AuthorizationService.isRestrictedToOwnData', () => {
  let service: AuthorizationService;
  let profile: { findFirst: jest.Mock };

  beforeEach(async () => {
    profile = { findFirst: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        {
          provide: PrismaService,
          useValue: { db: { profile } },
        },
      ],
    }).compile();
    service = module.get(AuthorizationService);
  });

  it('returns false for a manager (owner/branch manager) without checking clinical', async () => {
    profile.findFirst.mockResolvedValue({ id: 'pr-mgr' }); // isManager → true
    await expect(service.isRestrictedToOwnData('p', 'o')).resolves.toBe(false);
    // isManager short-circuits before the clinical check (one query only).
    expect(profile.findFirst).toHaveBeenCalledTimes(1);
  });

  it('returns true for a non-manager clinician (doctor)', async () => {
    profile.findFirst
      .mockResolvedValueOnce(null) // isManager → false
      .mockResolvedValueOnce({ id: 'pjf' }); // isClinical → true
    await expect(service.isRestrictedToOwnData('p', 'o')).resolves.toBe(true);
  });

  it('returns false for a non-manager, non-clinical caller (reception)', async () => {
    profile.findFirst.mockResolvedValue(null);
    await expect(service.isRestrictedToOwnData('p', 'o')).resolves.toBe(false);
  });
});
