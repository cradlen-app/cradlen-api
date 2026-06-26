import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy.js';
import type { AuthorizationService } from '../authorization/authorization.service.js';
import type { LastActiveService } from '../last-active.service.js';
import type { JwtAccessPayload } from '../interfaces/jwt-payload.interface.js';

function buildStrategy() {
  const getProfileContext = jest.fn();
  const authorizationService = {
    getProfileContext,
  } as unknown as AuthorizationService;

  const touchUser = jest.fn().mockResolvedValue(undefined);
  const lastActiveService = { touchUser } as unknown as LastActiveService;

  const authConfig = {
    jwt: { accessSecret: 'access-secret' },
  };

  const strategy = new JwtStrategy(
    authConfig as never,
    authorizationService,
    lastActiveService,
  );

  return { strategy, getProfileContext, touchUser };
}

describe('JwtStrategy.validate', () => {
  it('forwards a valid access payload to AuthorizationService.getProfileContext', async () => {
    const { strategy, getProfileContext, touchUser } = buildStrategy();
    const context = {
      userId: 'user-1',
      profileId: 'profile-1',
      organizationId: 'org-1',
      activeBranchId: 'branch-1',
      roles: ['OWNER'],
      branchIds: ['branch-1'],
    };
    getProfileContext.mockResolvedValue(context);

    const payload: JwtAccessPayload & { iat: number } = {
      userId: 'user-1',
      profileId: 'profile-1',
      organizationId: 'org-1',
      activeBranchId: 'branch-1',
      type: 'access',
      iat: 1_700_000_000,
    };

    await expect(strategy.validate(payload)).resolves.toBe(context);
    // Single AuthorizationService call — no separate user.findFirst path.
    // `iat` is forwarded so the staleness (password-change) check can run.
    expect(getProfileContext).toHaveBeenCalledTimes(1);
    // Fire-and-forget daily-active heartbeat for the authenticated user.
    expect(touchUser).toHaveBeenCalledWith('user-1');
    expect(getProfileContext).toHaveBeenCalledWith(
      'user-1',
      'profile-1',
      'org-1',
      'branch-1',
      1_700_000_000,
    );
  });

  it('rejects payloads with the wrong type before touching the database', async () => {
    const { strategy, getProfileContext } = buildStrategy();

    await expect(
      strategy.validate({
        userId: 'user-1',
        profileId: 'profile-1',
        organizationId: 'org-1',
        type: 'refresh',
      } as unknown as JwtAccessPayload),
    ).rejects.toThrow(UnauthorizedException);
    expect(getProfileContext).not.toHaveBeenCalled();
  });

  it('accepts a payload that has no aud claim (legacy / grace) — S-08', async () => {
    const { strategy, getProfileContext } = buildStrategy();
    getProfileContext.mockResolvedValue({});

    await strategy.validate({
      userId: 'user-1',
      profileId: 'profile-1',
      organizationId: 'org-1',
      type: 'access',
    });

    expect(getProfileContext).toHaveBeenCalled();
  });

  it('accepts a payload with aud="cradlen-api" — S-08', async () => {
    const { strategy, getProfileContext } = buildStrategy();
    getProfileContext.mockResolvedValue({});

    await strategy.validate({
      userId: 'user-1',
      profileId: 'profile-1',
      organizationId: 'org-1',
      type: 'access',
      aud: 'cradlen-api',
    } as JwtAccessPayload & { aud: string });

    expect(getProfileContext).toHaveBeenCalled();
  });

  it('rejects a payload whose aud claim is wrong — S-08', async () => {
    const { strategy, getProfileContext } = buildStrategy();

    await expect(
      strategy.validate({
        userId: 'user-1',
        profileId: 'profile-1',
        organizationId: 'org-1',
        type: 'access',
        aud: 'someone-else',
      } as JwtAccessPayload & { aud: string }),
    ).rejects.toThrow(UnauthorizedException);
    expect(getProfileContext).not.toHaveBeenCalled();
  });
});
