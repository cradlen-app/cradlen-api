import { AuthController } from './auth.controller.js';
import type { SignupService } from './services/signup.service.js';
import type { SessionsService } from './services/sessions.service.js';
import type { PasswordResetService } from './services/password-reset.service.js';
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
    Pick<SessionsService, 'login' | 'refresh' | 'logout' | 'getMe'>
  >;
  let passwordResetService: jest.Mocked<Pick<PasswordResetService, 'start'>>;

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
      refresh: jest.fn(),
      logout: jest.fn(),
      getMe: jest.fn(),
    };
    passwordResetService = {
      start: jest.fn(),
    };
    controller = new AuthController(
      signupService as unknown as SignupService,
      sessionsService as unknown as SessionsService,
      passwordResetService as unknown as PasswordResetService,
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

  it('delegates signup completion', async () => {
    const dto = {
      signup_token: 'token',
      organization_name: 'Clinic',
      specialties: ['General Medicine'],
      branch_name: 'Main',
      roles: ['OWNER'],
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

  it('revokes logout token', async () => {
    sessionsService.logout.mockResolvedValue(undefined);
    await controller.logout({ refresh_token: 'refresh' });
    expect(sessionsService.logout).toHaveBeenCalledWith('refresh');
  });

  it('delegates getMe with userId and profileId from auth context', async () => {
    const user: AuthContext = {
      userId: 'user-uuid',
      profileId: 'profile-uuid',
      organizationId: 'organization-uuid',
      roles: ['OWNER'],
      branchIds: ['branch-uuid'],
    };
    const meResponse = {
      id: 'user-uuid',
      first_name: 'Sara',
      last_name: 'Ali',
      email: 'sara@example.com',
      is_active: true,
      verified_at: null,
      created_at: new Date(),
      profiles: [],
    };
    sessionsService.getMe.mockResolvedValue(meResponse);

    await expect(controller.getMe(user)).resolves.toEqual(meResponse);
    expect(sessionsService.getMe).toHaveBeenCalledWith(
      'user-uuid',
      'profile-uuid',
    );
  });
});
