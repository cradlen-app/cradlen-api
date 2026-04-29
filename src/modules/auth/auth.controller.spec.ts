import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<
    Pick<
      AuthService,
      | 'signupStart'
      | 'signupVerify'
      | 'signupComplete'
      | 'login'
      | 'requestPhoneOtp'
      | 'verifyPhoneOtp'
      | 'selectProfile'
      | 'refresh'
      | 'logout'
    >
  >;

  beforeEach(() => {
    authService = {
      signupStart: jest.fn(),
      signupVerify: jest.fn(),
      signupComplete: jest.fn(),
      login: jest.fn(),
      requestPhoneOtp: jest.fn(),
      verifyPhoneOtp: jest.fn(),
      selectProfile: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
    };
    controller = new AuthController(authService as unknown as AuthService);
  });

  it('delegates signup start', async () => {
    const dto = {
      first_name: 'Sara',
      last_name: 'Ali',
      email: 'sara@example.com',
      password: 'Password1!',
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
      branch_name: 'Main',
      branch_address: '123 St',
      branch_city: 'Cairo',
      branch_governorate: 'Cairo',
      is_clinical: false,
    };
    const tokens = {
      type: 'tokens' as const,
      access_token: 'access',
      refresh_token: 'refresh',
      token_type: 'Bearer' as const,
      expires_in: 900,
    };
    authService.signupComplete.mockResolvedValue(tokens);

    await expect(controller.signupComplete(dto)).resolves.toEqual(tokens);
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

  it('revokes logout token', async () => {
    authService.logout.mockResolvedValue(undefined);
    await controller.logout({ refresh_token: 'refresh' });
    expect(authService.logout).toHaveBeenCalledWith('refresh');
  });
});
