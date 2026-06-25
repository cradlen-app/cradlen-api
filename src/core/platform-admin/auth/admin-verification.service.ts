import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { ERROR_CODES } from '@common/constant/error-codes.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EmailService } from '@infrastructure/email/email.service.js';
import authConfig, { type AuthConfig } from '@config/auth.config.js';

/**
 * Admin-scoped mirror of VerificationCodesService. Platform admins are not Users,
 * so their OTP rows key on `admin_id` (not `user_id`); the purpose is fixed to
 * ADMIN_LOGIN. Reuses the shared OTP config (TTL / attempts / resend caps) and
 * the global EmailService so behaviour matches the staff/patient flows exactly.
 */
@Injectable()
export class AdminVerificationService {
  private readonly authConfig: AuthConfig;

  constructor(
    private readonly prismaService: PrismaService,
    @Inject(authConfig.KEY)
    config: ConfigType<typeof authConfig>,
    private readonly mailService: EmailService,
  ) {
    this.authConfig = config;
  }

  /** Consume-old + create-new code row, then email the cleartext code. */
  async send(adminId: string, target: string, isResend = false): Promise<void> {
    const { otpTtlMinutes, otpMaxAttempts, otpBcryptRounds } =
      this.authConfig.verificationCodes;

    await this.prismaService.db.verificationCode.updateMany({
      where: { admin_id: adminId, purpose: 'ADMIN_LOGIN', consumed_at: null },
      data: { consumed_at: new Date() },
    });

    const code = randomInt(100000, 1000000).toString();
    const code_hash = await bcrypt.hash(code, otpBcryptRounds);
    const expires_at = new Date(Date.now() + otpTtlMinutes * 60 * 1000);
    await this.prismaService.db.verificationCode.create({
      data: {
        admin_id: adminId,
        target,
        channel: 'EMAIL',
        purpose: 'ADMIN_LOGIN',
        code_hash,
        expires_at,
        max_attempts: otpMaxAttempts,
        is_resend: isResend,
      },
    });

    await this.mailService.sendVerificationEmail(target, code);
  }

  /** Validates the newest unconsumed code, enforcing expiry + attempt cap. */
  async consume(adminId: string, code: string): Promise<void> {
    const record = await this.prismaService.db.verificationCode.findFirst({
      where: { admin_id: adminId, purpose: 'ADMIN_LOGIN', consumed_at: null },
      orderBy: { created_at: 'desc' },
    });
    if (!record) {
      throw new HttpException(
        {
          code: ERROR_CODES.INVALID_CODE,
          message: 'Verification code not found or already used',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (record.expires_at < new Date()) {
      throw new HttpException(
        {
          code: ERROR_CODES.CODE_EXPIRED,
          message: 'Verification code has expired',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (record.attempts >= record.max_attempts) {
      throw new HttpException(
        {
          code: ERROR_CODES.MAX_ATTEMPTS_EXCEEDED,
          message: 'Maximum verification attempts reached',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const matches = await bcrypt.compare(code, record.code_hash);
    if (!matches) {
      await this.prismaService.db.verificationCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new HttpException(
        {
          code: ERROR_CODES.INVALID_CODE,
          message: 'Incorrect verification code',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.prismaService.db.verificationCode.update({
      where: { id: record.id },
      data: { consumed_at: new Date() },
    });
  }

  /** Cooldown + per-hour cap before re-sending. */
  async assertCanResend(adminId: string): Promise<void> {
    const { resendCooldownSeconds, resendMaxPerHour } =
      this.authConfig.verificationCodes;

    const latestResend = await this.prismaService.db.verificationCode.findFirst(
      {
        where: { admin_id: adminId, purpose: 'ADMIN_LOGIN', is_resend: true },
        orderBy: { created_at: 'desc' },
      },
    );
    if (
      latestResend &&
      latestResend.created_at.getTime() >
        Date.now() - resendCooldownSeconds * 1000
    ) {
      throw new HttpException(
        'Please wait before requesting another code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const resendWindowStart = new Date(Date.now() - 60 * 60 * 1000);
    const recentResendCount =
      await this.prismaService.db.verificationCode.count({
        where: {
          admin_id: adminId,
          purpose: 'ADMIN_LOGIN',
          is_resend: true,
          created_at: { gte: resendWindowStart },
        },
      });
    if (recentResendCount >= resendMaxPerHour) {
      throw new HttpException(
        'Too many resend requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
