import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createAuthTestEnv } from './test-env.js';

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
});
