import * as bcrypt from 'bcryptjs';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminVerificationService } from './admin-verification.service.js';
import { AdminAuditService } from '../audit/admin-audit.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { TokensService } from '@core/auth/services/tokens.service.js';

jest.mock('bcryptjs');

const mockDb = {
  platformAdmin: { findFirst: jest.fn(), update: jest.fn() },
  refreshToken: { findUnique: jest.fn() },
};
const mockPrisma = { db: mockDb } as unknown as PrismaService;
const mockTokens = {
  issueAdminTokenPair: jest.fn(),
  decodeAdminRefreshToken: jest.fn(),
  revokeRefreshToken: jest.fn(),
};
const mockVerification = {
  send: jest.fn(),
  consume: jest.fn(),
  consumeSetPasswordToken: jest.fn(),
  assertCanResend: jest.fn(),
};
const mockAudit = { record: jest.fn() };

const TOKENS = {
  type: 'tokens',
  access_token: 'a',
  refresh_token: 'r',
  token_type: 'Bearer',
  expires_in: 900,
};

describe('AdminAuthService', () => {
  let service: AdminAuthService;

  beforeEach(() => {
    service = new AdminAuthService(
      mockPrisma,
      mockTokens as unknown as TokensService,
      mockVerification as unknown as AdminVerificationService,
      mockAudit as unknown as AdminAuditService,
    );
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
  });

  describe('login', () => {
    it('rejects with 401 when the admin does not exist', async () => {
      mockDb.platformAdmin.findFirst.mockResolvedValue(null);
      await expect(
        service.login({ email: 'x@y.com', password: 'p' }),
      ).rejects.toMatchObject({ status: 401 });
      expect(mockVerification.send).not.toHaveBeenCalled();
    });

    it('rejects with 401 on a wrong password (no OTP sent)', async () => {
      mockDb.platformAdmin.findFirst.mockResolvedValue({
        id: 'a1',
        email: 'a@c.com',
        password_hashed: 'h',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(
        service.login({ email: 'a@c.com', password: 'bad' }),
      ).rejects.toMatchObject({ status: 401 });
      expect(mockVerification.send).not.toHaveBeenCalled();
    });

    it('sends an OTP and returns otp_required on valid credentials', async () => {
      mockDb.platformAdmin.findFirst.mockResolvedValue({
        id: 'a1',
        email: 'a@c.com',
        password_hashed: 'h',
      });
      await expect(
        service.login({ email: 'a@c.com', password: 'good' }),
      ).resolves.toEqual({ otp_required: true });
      expect(mockVerification.send).toHaveBeenCalledWith('a1', 'a@c.com');
    });
  });

  describe('verifyOtp', () => {
    it('consumes the code and issues a token pair', async () => {
      mockDb.platformAdmin.findFirst.mockResolvedValue({
        id: 'a1',
        email: 'a@c.com',
      });
      mockTokens.issueAdminTokenPair.mockResolvedValue(TOKENS);

      const res = await service.verifyOtp({ email: 'a@c.com', code: '123456' });

      expect(mockVerification.consume).toHaveBeenCalledWith('a1', '123456');
      expect(mockTokens.issueAdminTokenPair).toHaveBeenCalledWith({
        adminId: 'a1',
      });
      expect(res).toBe(TOKENS);
    });

    it('rejects an unknown email with a generic INVALID_CODE (no enumeration)', async () => {
      mockDb.platformAdmin.findFirst.mockResolvedValue(null);
      await expect(
        service.verifyOtp({ email: 'nope@c.com', code: '123456' }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_CODE' } });
    });
  });

  describe('setPassword', () => {
    it('consumes the invite token, sets the password, audits, and logs in', async () => {
      mockDb.platformAdmin.findFirst.mockResolvedValue({
        id: 'a1',
        email: 'a@c.com',
      });
      mockTokens.issueAdminTokenPair.mockResolvedValue(TOKENS);

      const res = await service.setPassword({
        email: 'a@c.com',
        token: 'tok',
        password: 'newsecret8',
      });

      expect(mockVerification.consumeSetPasswordToken).toHaveBeenCalledWith(
        'a1',
        'tok',
      );
      expect(mockDb.platformAdmin.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { password_hashed: 'hashed' },
      });
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.set_password' }),
      );
      expect(res).toBe(TOKENS);
    });

    it('rejects an unknown email with a generic INVALID_CODE', async () => {
      mockDb.platformAdmin.findFirst.mockResolvedValue(null);
      await expect(
        service.setPassword({
          email: 'nope@c.com',
          token: 'tok',
          password: 'newsecret8',
        }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_CODE' } });
    });
  });

  describe('refresh', () => {
    beforeEach(() => {
      mockTokens.decodeAdminRefreshToken.mockReturnValue({
        adminId: 'a1',
        jti: 'j1',
        type: 'admin_refresh',
      });
    });

    it('rotates a valid admin refresh token', async () => {
      mockDb.refreshToken.findUnique.mockResolvedValue({
        jti: 'j1',
        is_revoked: false,
        expires_at: new Date(Date.now() + 1000),
        platform_admin_id: 'a1',
        user_id: null,
        patient_account_id: null,
        token_hash: 'th',
        platformAdmin: { id: 'a1', is_active: true, is_deleted: false },
      });
      mockTokens.issueAdminTokenPair.mockResolvedValue(TOKENS);

      const res = await service.refresh('raw');
      expect(mockTokens.issueAdminTokenPair).toHaveBeenCalledWith({
        adminId: 'a1',
        revokeJti: 'j1',
      });
      expect(res).toBe(TOKENS);
    });

    it('rejects a revoked refresh row', async () => {
      mockDb.refreshToken.findUnique.mockResolvedValue({
        jti: 'j1',
        is_revoked: true,
        expires_at: new Date(Date.now() + 1000),
        platform_admin_id: 'a1',
      });
      await expect(service.refresh('raw')).rejects.toMatchObject({
        status: 401,
      });
    });

    it('rejects a row owned by a staff user (defensive)', async () => {
      mockDb.refreshToken.findUnique.mockResolvedValue({
        jti: 'j1',
        is_revoked: false,
        expires_at: new Date(Date.now() + 1000),
        platform_admin_id: null,
        user_id: 'u1',
        token_hash: 'th',
        platformAdmin: null,
      });
      await expect(service.refresh('raw')).rejects.toMatchObject({
        status: 401,
      });
    });
  });

  describe('me', () => {
    it('returns the admin identity', async () => {
      mockDb.platformAdmin.findFirst.mockResolvedValue({
        id: 'a1',
        email: 'a@c.com',
        full_name: 'Admin',
      });
      await expect(
        service.me({ adminId: 'a1', email: 'a@c.com' }),
      ).resolves.toEqual({ id: 'a1', email: 'a@c.com', full_name: 'Admin' });
    });

    it('rejects when the admin no longer exists', async () => {
      mockDb.platformAdmin.findFirst.mockResolvedValue(null);
      await expect(
        service.me({ adminId: 'gone', email: 'a@c.com' }),
      ).rejects.toMatchObject({ status: 401 });
    });
  });

  describe('logout', () => {
    it('delegates to revokeRefreshToken', async () => {
      await service.logout('raw');
      expect(mockTokens.revokeRefreshToken).toHaveBeenCalledWith('raw');
    });
  });
});
