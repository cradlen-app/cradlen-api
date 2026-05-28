import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { ForgotPasswordDto } from '../dto/forgot-password.dto.js';
import type { ResendResetCodeDto } from '../dto/resend-reset-code.dto.js';
import type { VerifyResetCodeDto } from '../dto/verify-reset-code.dto.js';
import type { ResetPasswordDto } from '../dto/reset-password.dto.js';
import type { ResetTokenResponseDto } from '../dto/reset-token-response.dto.js';
import { TokensService } from './tokens.service.js';
import { VerificationCodesService } from './verification-codes.service.js';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly tokensService: TokensService,
    private readonly verificationCodesService: VerificationCodesService,
  ) {}

  async start(dto: ForgotPasswordDto): Promise<ResetTokenResponseDto> {
    const user = await this.prismaService.db.user.findFirst({
      where: {
        email: dto.email,
        is_deleted: false,
        is_active: true,
        verified_at: { not: null },
      },
    });

    if (!user?.email) {
      return { reset_token: '', expires_in: 0 };
    }

    await this.verificationCodesService.send({
      userId: user.id,
      target: user.email,
      purpose: 'PASSWORD_RESET',
    });

    return this.tokensService.issuePasswordResetToken(
      user.id,
      user.email,
      false,
    );
  }

  async resend(dto: ResendResetCodeDto): Promise<ResetTokenResponseDto> {
    const { userId, target } = this.tokensService.decodePasswordResetToken(
      dto.reset_token,
      false,
    );

    await this.verificationCodesService.assertCanResend({
      userId,
      purpose: 'PASSWORD_RESET',
    });

    await this.verificationCodesService.send({
      userId,
      target,
      purpose: 'PASSWORD_RESET',
      isResend: true,
    });

    return this.tokensService.issuePasswordResetToken(userId, target, false);
  }

  async verify(dto: VerifyResetCodeDto): Promise<ResetTokenResponseDto> {
    const { userId, target } = this.tokensService.decodePasswordResetToken(
      dto.reset_token,
      false,
    );

    await this.verificationCodesService.consume({
      userId,
      target,
      purpose: 'PASSWORD_RESET',
      code: dto.code,
    });

    return this.tokensService.issuePasswordResetToken(userId, target, true);
  }

  async reset(dto: ResetPasswordDto): Promise<void> {
    const { userId } = this.tokensService.decodePasswordResetToken(
      dto.reset_token,
      true,
    );

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    await this.prismaService.db.$transaction([
      this.prismaService.db.user.update({
        where: { id: userId },
        data: { password_hashed: passwordHash },
      }),
      this.prismaService.db.refreshToken.updateMany({
        where: { user_id: userId, is_revoked: false },
        data: { is_revoked: true },
      }),
    ]);
  }
}
