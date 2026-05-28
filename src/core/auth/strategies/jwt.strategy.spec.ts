import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy.js';
import type { AuthorizationService } from '../authorization/authorization.service.js';
import type { JwtAccessPayload } from '../interfaces/jwt-payload.interface.js';

function buildStrategy() {
  const getProfileContext = jest.fn();
  const authorizationService = {
    getProfileContext,
  } as unknown as AuthorizationService;

  const configService = {
    get: jest.fn().mockReturnValue({
      jwt: { accessSecret: 'access-secret' },
    }),
  };

  const strategy = new JwtStrategy(
    configService as never,
    authorizationService,
  );

  return { strategy, getProfileContext };
}

describe('JwtStrategy.validate', () => {
  it('forwards a valid access payload to AuthorizationService.getProfileContext', async () => {
    const { strategy, getProfileContext } = buildStrategy();
    const context = {
      userId: 'user-1',
      profileId: 'profile-1',
      organizationId: 'org-1',
      activeBranchId: 'branch-1',
      roles: ['OWNER'],
      branchIds: ['branch-1'],
    };
    getProfileContext.mockResolvedValue(context);

    const payload: JwtAccessPayload = {
      userId: 'user-1',
      profileId: 'profile-1',
      organizationId: 'org-1',
      activeBranchId: 'branch-1',
      type: 'access',
    };

    await expect(strategy.validate(payload)).resolves.toBe(context);
    // Single AuthorizationService call — no separate user.findFirst path.
    expect(getProfileContext).toHaveBeenCalledTimes(1);
    expect(getProfileContext).toHaveBeenCalledWith(
      'user-1',
      'profile-1',
      'org-1',
      'branch-1',
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
});
