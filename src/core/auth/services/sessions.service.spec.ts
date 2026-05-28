import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { JwtService } from '@nestjs/jwt';
import { createAuthTestEnv } from './test-env.js';

function signRefreshToken(
  jwtService: JwtService,
  args: {
    userId: string;
    profileId: string;
    organizationId: string;
    jti: string;
  },
) {
  return jwtService.sign(
    {
      userId: args.userId,
      profileId: args.profileId,
      organizationId: args.organizationId,
      jti: args.jti,
      type: 'refresh',
    },
    { secret: 'refresh-secret' },
  );
}

function signSelectionToken(jwtService: JwtService, userId: string) {
  return jwtService.sign(
    { userId, type: 'profile_selection' },
    { secret: 'access-secret' },
  );
}

function withRunningTransaction(): {
  $transaction: jest.Mock;
  refreshTokenUpdateMany: jest.Mock;
  refreshTokenCreate: jest.Mock;
} {
  const refreshTokenUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const refreshTokenCreate = jest.fn().mockResolvedValue({});
  const $transaction = jest.fn(
    async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({
        refreshToken: {
          updateMany: refreshTokenUpdateMany,
          create: refreshTokenCreate,
        },
      });
    },
  );
  return { $transaction, refreshTokenUpdateMany, refreshTokenCreate };
}

describe('SessionsService', () => {
  it('returns verify OTP onboarding requirement when pending user logs in', async () => {
    const { sessionsService, mocks } = createAuthTestEnv();
    mocks.userFindFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'sara@example.com',
      password_hashed: await bcrypt.hash('Password1!', 12),
      is_active: true,
      registration_status: 'PENDING',
      onboarding_completed: false,
    });

    await expect(
      sessionsService.login({
        email: 'sara@example.com',
        password: 'Password1!',
      }),
    ).resolves.toEqual({
      type: 'ONBOARDING_REQUIRED',
      step: 'VERIFY_OTP',
    });
    expect(mocks.profileFindMany).not.toHaveBeenCalled();
  });

  it('returns complete onboarding requirement for active users without onboarding', async () => {
    const { sessionsService, mocks } = createAuthTestEnv();
    mocks.userFindFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'sara@example.com',
      password_hashed: await bcrypt.hash('Password1!', 12),
      is_active: true,
      registration_status: 'ACTIVE',
      onboarding_completed: false,
    });

    await expect(
      sessionsService.login({
        email: 'sara@example.com',
        password: 'Password1!',
      }),
    ).resolves.toEqual({
      type: 'ONBOARDING_REQUIRED',
      step: 'COMPLETE_ONBOARDING',
    });
    expect(mocks.profileFindMany).not.toHaveBeenCalled();
  });

  it('returns profile selection for active users with completed onboarding', async () => {
    const { sessionsService, mocks } = createAuthTestEnv();
    mocks.userFindFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'sara@example.com',
      password_hashed: await bcrypt.hash('Password1!', 12),
      is_active: true,
      registration_status: 'ACTIVE',
      onboarding_completed: true,
    });
    mocks.profileFindMany.mockResolvedValue([
      {
        id: '22222222-2222-4222-8222-222222222222',
        organization_id: '33333333-3333-4333-8333-333333333333',
        organization: {
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Clinic',
        },
        roles: [{ role: { code: 'OWNER', name: 'OWNER' } }],
      },
    ]);
    mocks.getEffectiveBranchIds.mockResolvedValue([
      '44444444-4444-4444-8444-444444444444',
    ]);
    mocks.branchFindMany.mockResolvedValue([
      {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Main',
        is_main: true,
      },
    ]);

    await expect(
      sessionsService.login({
        email: 'sara@example.com',
        password: 'Password1!',
      }),
    ).resolves.toEqual({
      type: 'profile_selection',
      selection_token: expect.any(String),
      profiles: [
        {
          profile_id: '22222222-2222-4222-8222-222222222222',
          organization_id: '33333333-3333-4333-8333-333333333333',
          organization_name: 'Clinic',
          roles: ['OWNER'],
          branches: [
            {
              branch_id: '44444444-4444-4444-8444-444444444444',
              name: 'Main',
              is_main: true,
            },
          ],
        },
      ],
    });
  });

  it('requires branch id when selected profile has multiple branches', async () => {
    const { sessionsService, mocks, jwtService } = createAuthTestEnv();
    const selectionToken = jwtService.sign(
      {
        userId: '11111111-1111-4111-8111-111111111111',
        type: 'profile_selection',
      },
      { secret: 'access-secret' },
    );
    mocks.profileFindFirst.mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      organization_id: '33333333-3333-4333-8333-333333333333',
      user: { id: '11111111-1111-4111-8111-111111111111' },
    });
    mocks.getEffectiveBranchIds.mockResolvedValue([
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    ]);
    mocks.branchFindMany.mockResolvedValue([
      { id: '44444444-4444-4444-8444-444444444444' },
      { id: '55555555-5555-4555-8555-555555555555' },
    ]);

    await expect(
      sessionsService.selectProfile({
        selection_token: selectionToken,
        profile_id: '22222222-2222-4222-8222-222222222222',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects branch ids outside the selected profile', async () => {
    const { sessionsService, mocks, jwtService } = createAuthTestEnv();
    const selectionToken = jwtService.sign(
      {
        userId: '11111111-1111-4111-8111-111111111111',
        type: 'profile_selection',
      },
      { secret: 'access-secret' },
    );
    mocks.profileFindFirst.mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      organization_id: '33333333-3333-4333-8333-333333333333',
      user: { id: '11111111-1111-4111-8111-111111111111' },
    });
    mocks.getEffectiveBranchIds.mockResolvedValue([
      '44444444-4444-4444-8444-444444444444',
    ]);
    mocks.branchFindMany.mockResolvedValue([
      { id: '44444444-4444-4444-8444-444444444444' },
    ]);

    await expect(
      sessionsService.selectProfile({
        selection_token: selectionToken,
        profile_id: '22222222-2222-4222-8222-222222222222',
        branch_id: '55555555-5555-4555-8555-555555555555',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('returns current user with active profile data for getMe', async () => {
    const { sessionsService, mocks } = createAuthTestEnv();
    const userId = '11111111-1111-4111-8111-111111111111';
    const profileId = '22222222-2222-4222-8222-222222222222';
    const now = new Date();

    mocks.userFindFirst.mockResolvedValue({
      id: userId,
      first_name: 'Sara',
      last_name: 'Ali',
      email: 'sara@example.com',
      is_active: true,
      verified_at: now,
      created_at: now,
      profiles: [
        {
          id: profileId,
          organization_id: '33333333-3333-4333-8333-333333333333',
          executive_title: null,
          engagement_type: 'FULL_TIME',
          organization: {
            id: '33333333-3333-4333-8333-333333333333',
            name: 'Clinic',
            specialty_links: [
              {
                specialty: {
                  id: 'spec-1',
                  code: 'OBGYN',
                  name: 'Gynecology',
                },
              },
            ],
            status: 'ACTIVE',
          },
          roles: [{ role: { id: 'role-1', name: 'OWNER' } }],
          job_functions: [
            {
              job_function: {
                id: 'jf-1',
                code: 'OBGYN',
                name: 'OB/GYN',
                is_clinical: true,
              },
            },
          ],
          specialty_links: [
            {
              specialty: {
                id: 'spec-1',
                code: 'OBGYN',
                name: 'Gynecology',
              },
            },
          ],
        },
      ],
    });

    mocks.getEffectiveBranchIds.mockResolvedValue(['branch-1']);
    mocks.branchFindMany.mockResolvedValue([
      {
        id: 'branch-1',
        address: '123 Main St',
        city: 'Cairo',
        governorate: 'Cairo',
        country: null,
        is_main: true,
      },
    ]);

    const result = await sessionsService.getMe(userId, profileId);

    expect(result).toMatchObject({
      id: userId,
      first_name: 'Sara',
      last_name: 'Ali',
      email: 'sara@example.com',
      profiles: [
        {
          staff_id: profileId,
          executive_title: null,
          engagement_type: 'FULL_TIME',
          organization: {
            id: '33333333-3333-4333-8333-333333333333',
            name: 'Clinic',
            specialties: [{ id: 'spec-1', code: 'OBGYN', name: 'Gynecology' }],
          },
          roles: [{ id: 'role-1', name: 'OWNER' }],
          branches: [
            {
              id: 'branch-1',
              city: 'Cairo',
              is_main: true,
            },
          ],
          job_functions: [
            { id: 'jf-1', code: 'OBGYN', name: 'OB/GYN', is_clinical: true },
          ],
          specialties: [{ id: 'spec-1', code: 'OBGYN', name: 'Gynecology' }],
        },
      ],
    });
    expect(mocks.userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: userId }),
      }),
    );
  });

  it('throws NotFoundException when user not found in getMe', async () => {
    const { sessionsService, mocks } = createAuthTestEnv();
    mocks.userFindFirst.mockResolvedValue(null);

    await expect(
      sessionsService.getMe('missing-user', 'any-profile'),
    ).rejects.toThrow('User not found');
  });

  describe('refresh', () => {
    const userId = 'user-1';
    const profileId = 'profile-1';
    const organizationId = 'org-1';
    const jti = 'jti-original';

    it('rotates the token pair atomically when the stored row is valid', async () => {
      const { $transaction, refreshTokenUpdateMany, refreshTokenCreate } =
        withRunningTransaction();
      const { sessionsService, mocks, prismaService, jwtService } =
        createAuthTestEnv({ $transaction });
      const rawRefreshToken = signRefreshToken(jwtService, {
        userId,
        profileId,
        organizationId,
        jti,
      });
      const token_hash = await bcrypt.hash(rawRefreshToken, 12);
      prismaService.db.refreshToken.findUnique = jest.fn().mockResolvedValue({
        id: 'row-1',
        jti,
        token_hash,
        is_revoked: false,
        expires_at: new Date(Date.now() + 60_000),
        profile_id: profileId,
        organization_id: organizationId,
        active_branch_id: 'branch-1',
        user: { id: userId },
      });
      // assertProfileBelongsToUser inside issueTokenPair
      mocks.profileFindFirst.mockResolvedValue({ id: profileId });

      const result = await sessionsService.refresh({
        refresh_token: rawRefreshToken,
      });

      expect(result).toMatchObject({
        type: 'tokens',
        access_token: expect.any(String),
        refresh_token: expect.any(String),
      });
      expect(refreshTokenUpdateMany).toHaveBeenCalledWith({
        where: { jti, is_revoked: false },
        data: expect.objectContaining({ is_revoked: true }),
      });
      expect(refreshTokenCreate).toHaveBeenCalledTimes(1);
    });

    it('rejects an already-revoked refresh token (replay) before bcrypt or rotation', async () => {
      const { sessionsService, prismaService, jwtService } =
        createAuthTestEnv();
      const rawRefreshToken = signRefreshToken(jwtService, {
        userId,
        profileId,
        organizationId,
        jti,
      });
      prismaService.db.refreshToken.findUnique = jest.fn().mockResolvedValue({
        id: 'row-1',
        jti,
        token_hash: 'irrelevant',
        is_revoked: true,
        expires_at: new Date(Date.now() + 60_000),
        profile_id: profileId,
        organization_id: organizationId,
        active_branch_id: null,
        user: { id: userId },
      });

      await expect(
        sessionsService.refresh({ refresh_token: rawRefreshToken }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when the presented token hash does not match the stored hash', async () => {
      const { sessionsService, prismaService, jwtService } =
        createAuthTestEnv();
      const rawRefreshToken = signRefreshToken(jwtService, {
        userId,
        profileId,
        organizationId,
        jti,
      });
      const differentHash = await bcrypt.hash('a-different-token', 12);
      prismaService.db.refreshToken.findUnique = jest.fn().mockResolvedValue({
        id: 'row-1',
        jti,
        token_hash: differentHash,
        is_revoked: false,
        expires_at: new Date(Date.now() + 60_000),
        profile_id: profileId,
        organization_id: organizationId,
        active_branch_id: null,
        user: { id: userId },
      });

      await expect(
        sessionsService.refresh({ refresh_token: rawRefreshToken }),
      ).rejects.toThrow('Refresh token mismatch');
    });
  });

  describe('logout', () => {
    it('revokes the matching jti when given a valid refresh token', async () => {
      const refreshTokenUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const { sessionsService, prismaService, jwtService } =
        createAuthTestEnv();
      prismaService.db.refreshToken.updateMany = refreshTokenUpdateMany;
      const rawRefreshToken = signRefreshToken(jwtService, {
        userId: 'user-1',
        profileId: 'profile-1',
        organizationId: 'org-1',
        jti: 'logout-jti',
      });

      await expect(
        sessionsService.logout(rawRefreshToken),
      ).resolves.toBeUndefined();
      expect(refreshTokenUpdateMany).toHaveBeenCalledWith({
        where: { jti: 'logout-jti', is_revoked: false },
        data: expect.objectContaining({ is_revoked: true }),
      });
    });

    it('no-ops silently on a garbage refresh token', async () => {
      const refreshTokenUpdateMany = jest.fn();
      const { sessionsService, prismaService } = createAuthTestEnv();
      prismaService.db.refreshToken.updateMany = refreshTokenUpdateMany;

      await expect(
        sessionsService.logout('not-a-jwt'),
      ).resolves.toBeUndefined();
      expect(refreshTokenUpdateMany).not.toHaveBeenCalled();
    });
  });

  describe('switchBranch', () => {
    const userCtx = {
      userId: 'user-1',
      profileId: 'profile-1',
      organizationId: 'org-1',
      roles: ['OWNER'],
      branchIds: ['branch-allowed'],
    };

    it('rotates the token pair when the user can access the target branch', async () => {
      const { $transaction, refreshTokenCreate } = withRunningTransaction();
      const { sessionsService, mocks, prismaService } = createAuthTestEnv({
        $transaction,
      });
      const canAccessBranch = jest.fn().mockResolvedValue(true);
      // patch the AuthorizationService instance on this env
      (
        sessionsService as unknown as {
          authorizationService: { canAccessBranch: jest.Mock };
        }
      ).authorizationService.canAccessBranch = canAccessBranch;
      mocks.profileFindFirst.mockResolvedValue({ id: userCtx.profileId });
      // Silence unused-var lint
      void prismaService;

      const result = await sessionsService.switchBranch(userCtx, {
        branch_id: 'branch-allowed',
      });

      expect(result.type).toBe('tokens');
      expect(canAccessBranch).toHaveBeenCalledWith(
        userCtx.profileId,
        userCtx.organizationId,
        'branch-allowed',
      );
      expect(refreshTokenCreate).toHaveBeenCalledTimes(1);
    });

    it('rejects with ForbiddenException when the branch is out of scope', async () => {
      const { sessionsService } = createAuthTestEnv();
      const canAccessBranch = jest.fn().mockResolvedValue(false);
      (
        sessionsService as unknown as {
          authorizationService: { canAccessBranch: jest.Mock };
        }
      ).authorizationService.canAccessBranch = canAccessBranch;

      await expect(
        sessionsService.switchBranch(userCtx, { branch_id: 'branch-denied' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('selectProfile', () => {
    it('issues a token pair when exactly one branch is in scope', async () => {
      const userId = 'user-1';
      const profileId = 'profile-1';
      const organizationId = 'org-1';
      const branchId = 'branch-1';
      const { $transaction, refreshTokenCreate } = withRunningTransaction();
      const { sessionsService, mocks, jwtService } = createAuthTestEnv({
        $transaction,
      });
      mocks.profileFindFirst.mockResolvedValue({
        id: profileId,
        organization_id: organizationId,
        user: { id: userId },
      });
      mocks.getEffectiveBranchIds.mockResolvedValue([branchId]);
      mocks.branchFindMany.mockResolvedValue([{ id: branchId }]);

      const result = await sessionsService.selectProfile({
        selection_token: signSelectionToken(jwtService, userId),
        profile_id: profileId,
      });

      expect(result.type).toBe('tokens');
      expect(refreshTokenCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: userId,
            profile_id: profileId,
            organization_id: organizationId,
            active_branch_id: branchId,
          }),
        }),
      );
    });
  });

  describe('getMe', () => {
    it('aggregates branches per profile when the user has multiple profiles', async () => {
      const { sessionsService, mocks } = createAuthTestEnv();
      const userId = 'user-1';
      const profileId = 'profile-1';
      const otherProfileId = 'profile-2';
      const now = new Date();
      // getMe filters profiles by { id: profileId }, so only one profile
      // row is included in user.profiles. The aggregator must still cope
      // when that one profile has its own branch set distinct from any
      // other profile of the same user.
      mocks.userFindFirst.mockResolvedValue({
        id: userId,
        first_name: 'Sara',
        last_name: 'Ali',
        email: 'sara@example.com',
        is_active: true,
        verified_at: now,
        created_at: now,
        profiles: [
          {
            id: profileId,
            organization_id: 'org-1',
            executive_title: null,
            engagement_type: 'FULL_TIME',
            organization: {
              id: 'org-1',
              name: 'Clinic A',
              specialty_links: [],
              status: 'ACTIVE',
            },
            roles: [{ role: { id: 'role-1', name: 'OWNER' } }],
            job_functions: [],
            specialty_links: [],
          },
        ],
      });
      mocks.getEffectiveBranchIds.mockResolvedValue([
        'branch-a-1',
        'branch-a-2',
      ]);
      mocks.branchFindMany.mockResolvedValue([
        {
          id: 'branch-a-1',
          address: '1 Main',
          city: 'Cairo',
          governorate: 'Cairo',
          country: 'EG',
          is_main: true,
        },
        {
          id: 'branch-a-2',
          address: '2 Side',
          city: 'Giza',
          governorate: 'Giza',
          country: 'EG',
          is_main: false,
        },
      ]);

      const result = await sessionsService.getMe(userId, profileId);

      expect(result.profiles).toHaveLength(1);
      expect(result.profiles[0].branches).toHaveLength(2);
      // No request to a stale or unrelated profile id.
      expect(mocks.getEffectiveBranchIds).toHaveBeenCalledWith(
        profileId,
        'org-1',
      );
      expect(mocks.getEffectiveBranchIds).not.toHaveBeenCalledWith(
        otherProfileId,
        expect.anything(),
      );
    });
  });
});
