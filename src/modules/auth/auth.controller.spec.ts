import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';
import type { AuthContext } from '../../common/interfaces/auth-context.interface.js';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<
    Pick<
      AuthService,
      | 'signupStart'
      | 'signupVerify'
      | 'signupComplete'
      | 'resendOtp'
      | 'getRegistrationStatus'
      | 'login'
      | 'selectProfile'
      | 'refresh'
      | 'logout'
      | 'getMe'
    >
  >;

  beforeEach(() => {
    authService = {
      signupStart: jest.fn(),
      signupVerify: jest.fn(),
      signupComplete: jest.fn(),
      resendOtp: jest.fn(),
      getRegistrationStatus: jest.fn(),
      login: jest.fn(),
      selectProfile: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      getMe: jest.fn(),
    };
    controller = new AuthController(authService as unknown as AuthService);
  });

  it('delegates signup start', async () => {
    const dto = {
      first_name: 'Sara',
      last_name: 'Ali',
      email: 'sara@example.com',
      password: 'Password1!',
      confirm_password: 'Password1!',
    };
    authService.signupStart.mockResolvedValue({
      signup_token: 'token',
      expires_in: 1800,
    });

    await expect(controller.signupStart(dto)).resolves.toEqual({
      signup_token: 'token',
      expires_in: 1800,
    });
    expect(authService.signupStart).toHaveBeenCalledWith(dto);
  });

  it('delegates signup completion', async () => {
    const dto = {
      signup_token: 'token',
      account_name: 'Clinic',
      specialties: ['General Medicine'],
      branch_name: 'Main',
      roles: ['OWNER'],
    };
    const response = {
      type: 'profile_selection' as const,
      selection_token: 'selection-token',
      profiles: [],
    };
    authService.signupComplete.mockResolvedValue(response);

    await expect(controller.signupComplete(dto)).resolves.toEqual(response);
    expect(authService.signupComplete).toHaveBeenCalledWith(dto);
  });

  it('passes refresh dto through to the service', async () => {
    const dto = { refresh_token: 'raw-refresh-token' };
    const tokens = {
      type: 'tokens' as const,
      access_token: 'access',
      refresh_token: 'refresh',
      token_type: 'Bearer' as const,
      expires_in: 900,
    };
    authService.refresh.mockResolvedValue(tokens);

    await expect(controller.refresh(dto)).resolves.toEqual(tokens);
    expect(authService.refresh).toHaveBeenCalledWith(dto);
  });

  it('delegates signup resend', async () => {
    const dto = { email: 'sara@example.com' };
    authService.resendOtp.mockResolvedValue({ success: true });

    await expect(controller.resendOtp(dto)).resolves.toEqual({
      success: true,
    });
    expect(authService.resendOtp).toHaveBeenCalledWith(dto);
  });

  it('delegates registration status with query and authorization header', async () => {
    authService.getRegistrationStatus.mockResolvedValue({
      step: 'DONE',
      email: 'sara@example.com',
    });

    await expect(
      controller.getRegistrationStatus(
        { email: 'sara@example.com' },
        'Bearer token',
      ),
    ).resolves.toEqual({ step: 'DONE', email: 'sara@example.com' });
    expect(authService.getRegistrationStatus).toHaveBeenCalledWith({
      email: 'sara@example.com',
      authorization: 'Bearer token',
    });
  });

  it('revokes logout token', async () => {
    authService.logout.mockResolvedValue(undefined);
    await controller.logout({ refresh_token: 'refresh' });
    expect(authService.logout).toHaveBeenCalledWith('refresh');
  });

  it('delegates getMe with userId and profileId from auth context', async () => {
    const user: AuthContext = {
      userId: 'user-uuid',
      profileId: 'profile-uuid',
      accountId: 'account-uuid',
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
    authService.getMe.mockResolvedValue(meResponse);

    await expect(controller.getMe(user)).resolves.toEqual(meResponse);
    expect(authService.getMe).toHaveBeenCalledWith('user-uuid', 'profile-uuid');
  });
});
