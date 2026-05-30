import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import type { Prisma, VerificationPurpose } from '@prisma/client';
import { ERROR_CODES } from '@common/constant/error-codes.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EmailService } from '@infrastructure/email/email.service.js';
import authConfig, { type AuthConfig } from '@config/auth.config.js';

type PrismaTx = Prisma.TransactionClient;

export type VerificationPurposeInput = 'SIGNUP' | 'LOGIN' | 'PASSWORD_RESET';

export interface SendCodeInput {
  userId: string;
  target: string;
  purpose: VerificationPurposeInput;
  isResend?: boolean;
}

export interface ConsumeCodeInput {
  userId: string;
  target: string;
  purpose: VerificationPurposeInput;
  code: string;
}

export interface AssertCanResendInput {
  userId: string;
  purpose: VerificationPurposeInput;
}

@Injectable()
export class VerificationCodesService {
  private readonly authConfig: AuthConfig;

  constructor(
    private readonly prismaService: PrismaService,
    @Inject(authConfig.KEY)
    config: ConfigType<typeof authConfig>,
    private readonly mailService: EmailService,
  ) {
    this.authConfig = config;
  }

  /**
   * Persists the verification code (consume-old + create-new) and emails
   * the cleartext code to the target.
   *
   * If `tx` is supplied, the two writes use the caller's transaction so a
   * parent mutation (e.g. signup reactivation) commits atomically with
   * the code row. The email send happens AFTER the transaction returns,
   * intentionally — Resend's HTTP roundtrip should not hold a Postgres
   * connection open.
   */
  async send(input: SendCodeInput, tx?: PrismaTx): Promise<void> {
    const { otpTtlMinutes, otpMaxAttempts, otpBcryptRounds } =
      this.authConfig.verificationCodes;
    const db = tx ?? this.prismaService.db;

    await db.verificationCode.updateMany({
      where: {
        user_id: input.userId,
        purpose: input.purpose as VerificationPurpose,
        consumed_at: null,
      },
      data: { consumed_at: new Date() },
    });

    const code = randomInt(100000, 1000000).toString();
    const code_hash = await bcrypt.hash(code, otpBcryptRounds);
    const expires_at = new Date(Date.now() + otpTtlMinutes * 60 * 1000);
    await db.verificationCode.create({
      data: {
        user_id: input.userId,
        target: input.target,
        channel: 'EMAIL',
        purpose: input.purpose as VerificationPurpose,
        code_hash,
        expires_at,
        max_attempts: otpMaxAttempts,
        is_resend: input.isResend ?? false,
      },
    });

    await this.mailService.sendVerificationEmail(input.target, code);
  }

  async consume(input: ConsumeCodeInput): Promise<void> {
    const record = await this.prismaService.db.verificationCode.findFirst({
      where: {
        user_id: input.userId,
        target: input.target,
        purpose: input.purpose as VerificationPurpose,
        consumed_at: null,
      },
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

    const matches = await bcrypt.compare(input.code, record.code_hash);
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

  async assertCanResend(input: AssertCanResendInput): Promise<void> {
    const { resendCooldownSeconds, resendMaxPerHour } =
      this.authConfig.verificationCodes;

    const latestResend = await this.prismaService.db.verificationCode.findFirst(
      {
        where: {
          user_id: input.userId,
          purpose: input.purpose as VerificationPurpose,
          is_resend: true,
        },
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
          user_id: input.userId,
          purpose: input.purpose as VerificationPurpose,
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
