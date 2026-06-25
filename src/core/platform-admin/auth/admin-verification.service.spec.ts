import * as bcrypt from 'bcryptjs';
import { AdminVerificationService } from './admin-verification.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EmailService } from '@infrastructure/email/email.service.js';
import type { AuthConfig } from '@config/auth.config.js';

jest.mock('bcryptjs');

const mockDb = {
  verificationCode: {
    updateMany: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
};
const mockPrisma = { db: mockDb } as unknown as PrismaService;
const mockMail = {
  sendVerificationEmail: jest.fn(),
};
const config = {
  verificationCodes: {
    otpTtlMinutes: 15,
    otpMaxAttempts: 5,
    otpBcryptRounds: 10,
    resendCooldownSeconds: 60,
    resendMaxPerHour: 5,
  },
} as unknown as AuthConfig;

describe('AdminVerificationService', () => {
  let service: AdminVerificationService;

  beforeEach(() => {
    service = new AdminVerificationService(
      mockPrisma,
      config,
      mockMail as unknown as EmailService,
    );
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  });

  describe('send', () => {
    it('consumes prior codes, creates a fresh ADMIN_LOGIN row, and emails the code', async () => {
      await service.send('admin-1', 'admin@cradlen.com');

      expect(mockDb.verificationCode.updateMany).toHaveBeenCalledWith({
        where: {
          admin_id: 'admin-1',
          purpose: 'ADMIN_LOGIN',
          consumed_at: null,
        },
        data: { consumed_at: expect.any(Date) },
      });
      const created = mockDb.verificationCode.create.mock.calls[0][0].data;
      expect(created).toMatchObject({
        admin_id: 'admin-1',
        purpose: 'ADMIN_LOGIN',
        channel: 'EMAIL',
        code_hash: 'hashed',
        is_resend: false,
      });
      expect(mockMail.sendVerificationEmail).toHaveBeenCalledWith(
        'admin@cradlen.com',
        expect.stringMatching(/^\d{6}$/),
      );
    });

    it('marks the row as a resend when requested', async () => {
      await service.send('admin-1', 'admin@cradlen.com', true);
      expect(
        mockDb.verificationCode.create.mock.calls[0][0].data.is_resend,
      ).toBe(true);
    });
  });

  describe('consume', () => {
    const future = new Date(Date.now() + 60_000);

    it('throws INVALID_CODE when no unconsumed code exists', async () => {
      mockDb.verificationCode.findFirst.mockResolvedValue(null);
      await expect(service.consume('admin-1', '123456')).rejects.toMatchObject({
        response: { code: 'INVALID_CODE' },
      });
    });

    it('throws CODE_EXPIRED for an expired code', async () => {
      mockDb.verificationCode.findFirst.mockResolvedValue({
        id: 'v1',
        expires_at: new Date(Date.now() - 1000),
        attempts: 0,
        max_attempts: 5,
        code_hash: 'hashed',
      });
      await expect(service.consume('admin-1', '123456')).rejects.toMatchObject({
        response: { code: 'CODE_EXPIRED' },
      });
    });

    it('throws MAX_ATTEMPTS_EXCEEDED once attempts hit the cap', async () => {
      mockDb.verificationCode.findFirst.mockResolvedValue({
        id: 'v1',
        expires_at: future,
        attempts: 5,
        max_attempts: 5,
        code_hash: 'hashed',
      });
      await expect(service.consume('admin-1', '123456')).rejects.toMatchObject({
        response: { code: 'MAX_ATTEMPTS_EXCEEDED' },
      });
    });

    it('increments attempts and throws INVALID_CODE on a wrong code', async () => {
      mockDb.verificationCode.findFirst.mockResolvedValue({
        id: 'v1',
        expires_at: future,
        attempts: 1,
        max_attempts: 5,
        code_hash: 'hashed',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.consume('admin-1', '000000')).rejects.toMatchObject({
        response: { code: 'INVALID_CODE' },
      });
      expect(mockDb.verificationCode.update).toHaveBeenCalledWith({
        where: { id: 'v1' },
        data: { attempts: { increment: 1 } },
      });
    });

    it('consumes the row on a correct code', async () => {
      mockDb.verificationCode.findFirst.mockResolvedValue({
        id: 'v1',
        expires_at: future,
        attempts: 0,
        max_attempts: 5,
        code_hash: 'hashed',
      });
      await service.consume('admin-1', '123456');
      expect(mockDb.verificationCode.update).toHaveBeenCalledWith({
        where: { id: 'v1' },
        data: { consumed_at: expect.any(Date) },
      });
    });
  });

  describe('assertCanResend', () => {
    it('throws 429 while within the cooldown window', async () => {
      mockDb.verificationCode.findFirst.mockResolvedValue({
        created_at: new Date(Date.now() - 10_000), // 10s ago, cooldown is 60s
      });
      await expect(service.assertCanResend('admin-1')).rejects.toMatchObject({
        status: 429,
      });
    });

    it('throws 429 when the hourly resend cap is reached', async () => {
      mockDb.verificationCode.findFirst.mockResolvedValue(null);
      mockDb.verificationCode.count.mockResolvedValue(5);
      await expect(service.assertCanResend('admin-1')).rejects.toMatchObject({
        status: 429,
      });
    });

    it('passes when under the cooldown and the cap', async () => {
      mockDb.verificationCode.findFirst.mockResolvedValue(null);
      mockDb.verificationCode.count.mockResolvedValue(0);
      await expect(service.assertCanResend('admin-1')).resolves.toBeUndefined();
    });
  });
});
