import { AuthController } from './auth.controller.js';
import type { SignupService } from './services/signup.service.js';
import type { SessionsService } from './services/sessions.service.js';
import type { PasswordResetService } from './services/password-reset.service.js';
import type { TokensService } from './services/tokens.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';

describe('AuthController', () => {
  let controller: AuthController;
  let signupService: jest.Mocked<
    Pick<
      SignupService,
      'start' | 'verify' | 'complete' | 'resendOtp' | 'getRegistrationStatus'
    >
  >;
  let sessionsService: jest.Mocked<
    Pick<
      SessionsService,
      | 'login'
      | 'selectProfile'
      | 'switchBranch'
      | 'refresh'
      | 'logout'
      | 'getMe'
    >
  >;
  let passwordResetService: jest.Mocked<
    Pick<PasswordResetService, 'start' | 'resend' | 'verify' | 'reset'>
  >;
  let tokensService: jest.Mocked<Pick<TokensService, 'issueWsTicket'>>;

  const authContext: AuthContext = {
    userId: 'user-uuid',
    profileId: 'profile-uuid',
    organizationId: 'organization-uuid',
    activeBranchId: 'branch-uuid',
    roles: ['OWNER'],
    branchIds: ['branch-uuid'],
  };

  beforeEach(() => {
    signupService = {
      start: jest.fn(),
      verify: jest.fn(),
      complete: jest.fn(),
      resendOtp: jest.fn(),
      getRegistrationStatus: jest.fn(),
    };
    sessionsService = {
      login: jest.fn(),
      selectProfile: jest.fn(),
      switchBranch: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      getMe: jest.fn(),
    };
    passwordResetService = {
      start: jest.fn(),
      resend: jest.fn(),
      verify: jest.fn(),
      reset: jest.fn(),
    };
    tokensService = {
      issueWsTicket: jest.fn(),
    };
    controller = new AuthController(
      signupService as unknown as SignupService,
      sessionsService as unknown as SessionsService,
      passwordResetService as unknown as PasswordResetService,
      tokensService as unknown as TokensService,
    );
  });

  it('delegates signup start', async () => {
    const dto = {
      first_name: 'Sara',
      last_name: 'Ali',
      email: 'sara@example.com',
      password: 'Password1!',
      confirm_password: 'Password1!',
    };
    signupService.start.mockResolvedValue({
      signup_token: 'token',
      expires_in: 1800,
    });

    await expect(controller.signupStart(dto)).resolves.toEqual({
      signup_token: 'token',
      expires_in: 1800,
    });
    expect(signupService.start).toHaveBeenCalledWith(dto);
  });

  it('delegates signup verify', async () => {
    const dto = { signup_token: 'token', code: '123456' };
    signupService.verify.mockResolvedValue({
      signup_token: 'fresh-token',
      expires_in: 1800,
    });

    await expect(controller.signupVerify(dto)).resolves.toEqual({
      signup_token: 'fresh-token',
      expires_in: 1800,
    });
    expect(signupService.verify).toHaveBeenCalledWith(dto);
  });

  it('delegates signup completion', async () => {
    const dto = {
      signup_token: 'token',
      organization_name: 'Clinic',
      specialties: ['General Medicine'],
      branch_name: 'Main',
      branch_address: '1 St',
      branch_city: 'Cairo',
      branch_governorate: 'Cairo',
    };
    const response = {
      type: 'profile_selection' as const,
      selection_token: 'selection-token',
      profiles: [],
    };
    signupService.complete.mockResolvedValue(response);

    await expect(controller.signupComplete(dto)).resolves.toEqual(response);
    expect(signupService.complete).toHaveBeenCalledWith(dto);
  });

  it('delegates signup resend', async () => {
    const dto = { email: 'sara@example.com' };
    signupService.resendOtp.mockResolvedValue({ success: true });

    await expect(controller.resendOtp(dto)).resolves.toEqual({
      success: true,
    });
    expect(signupService.resendOtp).toHaveBeenCalledWith(dto);
  });

  it('delegates registration status with query and authorization header', async () => {
    signupService.getRegistrationStatus.mockResolvedValue({
      step: 'DONE',
      email: 'sara@example.com',
    });

    await expect(
      controller.getRegistrationStatus(
        { email: 'sara@example.com' },
        'Bearer token',
      ),
    ).resolves.toEqual({ step: 'DONE', email: 'sara@example.com' });
    expect(signupService.getRegistrationStatus).toHaveBeenCalledWith({
      email: 'sara@example.com',
      authorization: 'Bearer token',
    });
  });

  it('delegates login', async () => {
    const dto = { email: 'sara@example.com', password: 'Password1!' };
    const response = {
      type: 'profile_selection' as const,
      selection_token: 'selection-token',
      profiles: [],
    };
    sessionsService.login.mockResolvedValue(response);

    await expect(controller.login(dto)).resolves.toEqual(response);
    expect(sessionsService.login).toHaveBeenCalledWith(dto);
  });

  it('delegates profile selection', async () => {
    const dto = {
      selection_token: 'selection-token',
      profile_id: 'profile-uuid',
      branch_id: 'branch-uuid',
    };
    const tokens = {
      type: 'tokens' as const,
      access_token: 'access',
      refresh_token: 'refresh',
      token_type: 'Bearer' as const,
      expires_in: 900,
    };
    sessionsService.selectProfile.mockResolvedValue(tokens);

    await expect(controller.selectProfile(dto)).resolves.toEqual(tokens);
    expect(sessionsService.selectProfile).toHaveBeenCalledWith(dto);
  });

  it('delegates branch switch with auth context and dto', async () => {
    const dto = { branch_id: 'other-branch-uuid' };
    const tokens = {
      type: 'tokens' as const,
      access_token: 'access',
      refresh_token: 'refresh',
      token_type: 'Bearer' as const,
      expires_in: 900,
    };
    sessionsService.switchBranch.mockResolvedValue(tokens);

    await expect(controller.switchBranch(authContext, dto)).resolves.toEqual(
      tokens,
    );
    expect(sessionsService.switchBranch).toHaveBeenCalledWith(authContext, dto);
  });

  it('mints a ws ticket from the auth context', () => {
    const ticket = { ticket: 'ws-ticket', expires_in: 60 };
    tokensService.issueWsTicket.mockReturnValue(ticket);

    expect(controller.mintWsTicket(authContext)).toEqual(ticket);
    expect(tokensService.issueWsTicket).toHaveBeenCalledWith({
      user: { id: authContext.userId },
      profileId: authContext.profileId,
      organizationId: authContext.organizationId,
      activeBranchId: authContext.activeBranchId,
    });
  });

  it('passes refresh dto through to the sessions service', async () => {
    const dto = { refresh_token: 'raw-refresh-token' };
    const tokens = {
      type: 'tokens' as const,
      access_token: 'access',
      refresh_token: 'refresh',
      token_type: 'Bearer' as const,
      expires_in: 900,
    };
    sessionsService.refresh.mockResolvedValue(tokens);

    await expect(controller.refresh(dto)).resolves.toEqual(tokens);
    expect(sessionsService.refresh).toHaveBeenCalledWith(dto);
  });

  it('revokes logout token', async () => {
    sessionsService.logout.mockResolvedValue(undefined);
    await controller.logout({ refresh_token: 'refresh' });
    expect(sessionsService.logout).toHaveBeenCalledWith('refresh');
  });

  it('delegates getMe with userId and profileId from auth context', async () => {
    const meResponse = {
      id: 'user-uuid',
      first_name: 'Sara',
      last_name: 'Ali',
      email: 'sara@example.com',
      phone_number: null,
      is_active: true,
      verified_at: null,
      created_at: new Date(),
      profiles: [],
    };
    sessionsService.getMe.mockResolvedValue(meResponse);

    await expect(controller.getMe(authContext)).resolves.toEqual(meResponse);
    expect(sessionsService.getMe).toHaveBeenCalledWith(
      'user-uuid',
      'profile-uuid',
    );
  });

  describe('password reset delegation', () => {
    const resetTokenResponse = { reset_token: 'reset', expires_in: 900 };

    it('delegates forgot-password start', async () => {
      const dto = { email: 'sara@example.com' };
      passwordResetService.start.mockResolvedValue(resetTokenResponse);

      await expect(controller.forgotPassword(dto)).resolves.toEqual(
        resetTokenResponse,
      );
      expect(passwordResetService.start).toHaveBeenCalledWith(dto);
    });

    it('delegates reset-code resend', async () => {
      const dto = { email: 'sara@example.com' };
      passwordResetService.resend.mockResolvedValue(resetTokenResponse);

      await expect(controller.resendPasswordResetCode(dto)).resolves.toEqual(
        resetTokenResponse,
      );
      expect(passwordResetService.resend).toHaveBeenCalledWith(dto);
    });

    it('delegates verify reset code', async () => {
      const dto = { reset_token: 'reset', code: '123456' };
      passwordResetService.verify.mockResolvedValue(resetTokenResponse);

      await expect(controller.verifyResetCode(dto)).resolves.toEqual(
        resetTokenResponse,
      );
      expect(passwordResetService.verify).toHaveBeenCalledWith(dto);
    });

    it('delegates reset password', async () => {
      const dto = {
        reset_token: 'reset',
        password: 'Password1!',
        confirm_password: 'Password1!',
      };
      passwordResetService.reset.mockResolvedValue(undefined);

      await controller.resetPassword(dto);
      expect(passwordResetService.reset).toHaveBeenCalledWith(dto);
    });
  });
});
