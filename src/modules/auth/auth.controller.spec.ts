import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import type { User } from '@prisma/client';

const mockAuthService = {
  registerPersonal: jest.fn(),
  verifyEmail: jest.fn(),
  resendOtp: jest.fn(),
  registerOrganization: jest.fn(),
  login: jest.fn(),
  refresh: jest.fn(),
  logout: jest.fn(),
  getMe: jest.fn(),
};

const MOCK_TOKEN_RESPONSE = {
  registration_token: 'token-abc',
  expires_in: 1800,
};
const MOCK_AUTH_TOKENS = {
  access_token: 'access-abc',
  refresh_token: 'refresh-abc',
  token_type: 'Bearer',
  expires_in: 900,
};
const MOCK_USER = {
  id: 'user-uuid',
  first_name: 'John',
  last_name: 'Doe',
  email: 'john@example.com',
  is_active: true,
  verified_at: new Date(),
  created_at: new Date(),
} as unknown as User;

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('registerPersonal', () => {
    it('delegates to service and returns result', async () => {
      mockAuthService.registerPersonal.mockResolvedValue(MOCK_TOKEN_RESPONSE);
      const dto = {
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
        password: 'P1!',
        confirm_password: 'P1!',
        is_clinical: false,
      };

      const result = await controller.registerPersonal(dto as never);

      expect(mockAuthService.registerPersonal).toHaveBeenCalledWith(dto);
      expect(result).toEqual(MOCK_TOKEN_RESPONSE);
    });
  });

  describe('verifyEmail', () => {
    it('passes registration_token and code to service', async () => {
      mockAuthService.verifyEmail.mockResolvedValue(MOCK_TOKEN_RESPONSE);
      const dto = { registration_token: 'reg-token', code: '123456' };

      const result = await controller.verifyEmail(dto as never);

      expect(mockAuthService.verifyEmail).toHaveBeenCalledWith(
        'reg-token',
        '123456',
      );
      expect(result).toEqual(MOCK_TOKEN_RESPONSE);
    });
  });

  describe('resendOtp', () => {
    it('passes registration_token to service', async () => {
      mockAuthService.resendOtp.mockResolvedValue(MOCK_TOKEN_RESPONSE);
      const dto = { registration_token: 'reg-token' };

      const result = await controller.resendOtp(dto as never);

      expect(mockAuthService.resendOtp).toHaveBeenCalledWith('reg-token');
      expect(result).toEqual(MOCK_TOKEN_RESPONSE);
    });
  });

  describe('registerOrganization', () => {
    it('passes full dto to service', async () => {
      mockAuthService.registerOrganization.mockResolvedValue(MOCK_AUTH_TOKENS);
      const dto = {
        registration_token: 'reg-token',
        organization_name: 'Clinic',
        branch_address: '123 St',
        branch_city: 'Cairo',
        branch_governorate: 'Cairo',
      };

      const result = await controller.registerOrganization(dto as never);

      expect(mockAuthService.registerOrganization).toHaveBeenCalledWith(dto);
      expect(result).toEqual(MOCK_AUTH_TOKENS);
    });
  });

  describe('login', () => {
    it('passes dto to service', async () => {
      mockAuthService.login.mockResolvedValue(MOCK_AUTH_TOKENS);
      const dto = { email: 'john@example.com', password: 'P1!' };

      const result = await controller.login(dto as never);

      expect(mockAuthService.login).toHaveBeenCalledWith(dto);
      expect(result).toEqual(MOCK_AUTH_TOKENS);
    });
  });

  describe('refresh', () => {
    it('passes refresh_token string to service', async () => {
      mockAuthService.refresh.mockResolvedValue(MOCK_AUTH_TOKENS);
      const dto = { refresh_token: 'raw-refresh-token' };

      const result = await controller.refresh(dto as never);

      expect(mockAuthService.refresh).toHaveBeenCalledWith('raw-refresh-token');
      expect(result).toEqual(MOCK_AUTH_TOKENS);
    });
  });

  describe('logout', () => {
    it('calls service and returns void', async () => {
      mockAuthService.logout.mockResolvedValue(undefined);
      const dto = { refresh_token: 'raw-refresh-token' };

      await controller.logout(dto as never);

      expect(mockAuthService.logout).toHaveBeenCalledWith('raw-refresh-token');
    });
  });

  describe('me', () => {
    it('delegates user to getMe and returns result', () => {
      const meResponse = {
        id: MOCK_USER.id,
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
        is_active: true,
        verified_at: MOCK_USER.verified_at,
        created_at: MOCK_USER.created_at,
      };
      mockAuthService.getMe.mockReturnValue(meResponse);

      const result = controller.me(MOCK_USER);

      expect(mockAuthService.getMe).toHaveBeenCalledWith(MOCK_USER);
      expect(result).toEqual(meResponse);
    });
  });
});
