import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
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
            {
              roles: {
                some: {
                  role: { name: { in: ['OWNER', 'BRANCH_MANAGER'] } },
                },
              },
            },
            {
              job_functions: {
                some: { job_function: { code: { in: ['RECEPTIONIST'] } } },
              },
            },
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
  let profileRole: { findFirst: jest.Mock };
  let profileBranch: { findMany: jest.Mock; findFirst: jest.Mock };
  let branch: { findMany: jest.Mock; findFirst: jest.Mock };
  let role: { findMany: jest.Mock };

  const stubOwner = () => profileRole.findFirst.mockResolvedValue({ id: 'pr' });
  const stubBranchManager = () => {
    // First call: canManageStaff (returns OWNER or BRANCH_MANAGER row).
    // Second call: isOwner check (returns null — caller is not OWNER).
    profileRole.findFirst.mockResolvedValueOnce({ id: 'pr-mgr' });
    profileRole.findFirst.mockResolvedValueOnce(null);
  };
  const stubNoRole = () => profileRole.findFirst.mockResolvedValue(null);

  beforeEach(async () => {
    profileRole = { findFirst: jest.fn() };
    profileBranch = { findMany: jest.fn(), findFirst: jest.fn() };
    branch = { findMany: jest.fn(), findFirst: jest.fn() };
    role = { findMany: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        {
          provide: PrismaService,
          useValue: {
            db: { profileRole, profileBranch, branch, role },
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
    it('is a no-op for empty roleIds', async () => {
      await expect(
        service.assertNoPrivilegedRoleAssignment('p', 'o', []),
      ).resolves.toBeUndefined();
    });

    it('allows any roles when caller is OWNER', async () => {
      stubOwner();
      await expect(
        service.assertNoPrivilegedRoleAssignment('p', 'o', ['r1', 'r2']),
      ).resolves.toBeUndefined();
      expect(role.findMany).not.toHaveBeenCalled();
    });

    it('throws when non-OWNER tries to assign OWNER or BRANCH_MANAGER', async () => {
      stubNoRole();
      role.findMany.mockResolvedValue([{ name: 'BRANCH_MANAGER' }]);
      await expect(
        service.assertNoPrivilegedRoleAssignment('p', 'o', ['r1']),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows non-OWNER to assign non-privileged roles', async () => {
      stubNoRole();
      role.findMany.mockResolvedValue([]);
      await expect(
        service.assertNoPrivilegedRoleAssignment('p', 'o', ['r1', 'r2']),
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
