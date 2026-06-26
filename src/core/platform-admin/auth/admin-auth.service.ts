import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { ERROR_CODES } from '@common/constant/error-codes.js';
import type { AdminAuthContext } from '@common/interfaces/admin-auth-context.interface.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { TokensService } from '@core/auth/services/tokens.service.js';
import type { AuthTokensDto } from '@core/auth/dto/auth-tokens.dto.js';
import { AdminAuditService } from '../audit/admin-audit.service.js';
import { AdminVerificationService } from './admin-verification.service.js';
import type { AdminSetPasswordDto } from './dto/admin-set-password.dto.js';
import type { AdminLoginDto } from './dto/admin-login.dto.js';
import type { AdminVerifyOtpDto } from './dto/admin-verify-otp.dto.js';
import type { AdminResendOtpDto } from './dto/admin-resend-otp.dto.js';
import type { AdminLoginResponseDto } from './dto/admin-login-response.dto.js';
import type { AdminMeResponseDto } from './dto/admin-me-response.dto.js';

/**
 * Platform-admin authentication: password → email OTP → token pair. There is no
 * self-signup; the first admin is seeded from env. Flat tier — any active admin
 * is fully authorized once a token is issued.
 */
@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly tokensService: TokensService,
    private readonly verification: AdminVerificationService,
    private readonly audit: AdminAuditService,
  ) {}

  /**
   * Sets an invited admin's password from a single-use invite token and logs
   * them in. The emailed token proves email ownership, so no extra OTP step is
   * required. Generic failures avoid leaking which emails exist.
   */
  async setPassword(dto: AdminSetPasswordDto): Promise<AuthTokensDto> {
    const admin = await this.requireActiveAdmin(dto.email);
    await this.verification.consumeSetPasswordToken(admin.id, dto.token);

    const password_hashed = await bcrypt.hash(dto.password, 12);
    await this.prismaService.db.platformAdmin.update({
      where: { id: admin.id },
      data: { password_hashed },
    });
    await this.audit.record({
      adminId: admin.id,
      action: 'admin.set_password',
      targetType: 'platform_admin',
      targetId: admin.id,
    });

    return this.tokensService.issueAdminTokenPair({ adminId: admin.id });
  }

  /** Step 1: verify the password, then email a login code. */
  async login(dto: AdminLoginDto): Promise<AdminLoginResponseDto> {
    const admin = await this.prismaService.db.platformAdmin.findFirst({
      where: { email: dto.email, is_active: true, is_deleted: false },
      select: { id: true, email: true, password_hashed: true },
    });
    if (!admin?.password_hashed) throw this.invalidCredentials();

    const ok = await bcrypt.compare(dto.password, admin.password_hashed);
    if (!ok) throw this.invalidCredentials();

    await this.verification.send(admin.id, admin.email);
    return { otp_required: true };
  }

  /** Step 2: consume the code and issue an access + refresh pair. */
  async verifyOtp(dto: AdminVerifyOtpDto): Promise<AuthTokensDto> {
    const admin = await this.requireActiveAdmin(dto.email);
    await this.verification.consume(admin.id, dto.code);
    return this.tokensService.issueAdminTokenPair({ adminId: admin.id });
  }

  /** Re-send a login code (cooldown + per-hour cap enforced). */
  async resendOtp(dto: AdminResendOtpDto): Promise<void> {
    const admin = await this.requireActiveAdmin(dto.email);
    await this.verification.assertCanResend(admin.id);
    await this.verification.send(admin.id, admin.email, true);
  }

  async me(ctx: AdminAuthContext): Promise<AdminMeResponseDto> {
    const admin = await this.prismaService.db.platformAdmin.findFirst({
      where: { id: ctx.adminId, is_active: true, is_deleted: false },
      select: { id: true, email: true, full_name: true },
    });
    if (!admin) throw new UnauthorizedException('Invalid auth context');
    return admin;
  }

  /** Rotate an admin refresh token for a fresh pair (old jti revoked atomically). */
  async refresh(refreshToken: string): Promise<AuthTokensDto> {
    const payload = this.tokensService.decodeAdminRefreshToken(refreshToken);

    const stored = await this.prismaService.db.refreshToken.findUnique({
      where: { jti: payload.jti },
      include: { platformAdmin: true },
    });
    if (!stored || stored.is_revoked || stored.expires_at < new Date()) {
      throw new UnauthorizedException('Refresh token revoked or expired');
    }
    // An admin refresh row is owned by a PlatformAdmin, never a staff/patient row.
    if (
      !stored.platform_admin_id ||
      stored.user_id ||
      stored.patient_account_id
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const matches = await bcrypt.compare(refreshToken, stored.token_hash);
    if (!matches) throw new UnauthorizedException('Refresh token mismatch');

    const admin = stored.platformAdmin;
    if (!admin || admin.is_deleted || !admin.is_active) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.tokensService.issueAdminTokenPair({
      adminId: admin.id,
      revokeJti: stored.jti,
    });
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokensService.revokeRefreshToken(refreshToken);
  }

  private async requireActiveAdmin(
    email: string,
  ): Promise<{ id: string; email: string }> {
    const admin = await this.prismaService.db.platformAdmin.findFirst({
      where: { email, is_active: true, is_deleted: false },
      select: { id: true, email: true },
    });
    // Email is only reachable here after a successful password step (login),
    // so a generic INVALID_CODE keeps the OTP step from leaking admin existence.
    if (!admin) {
      throw new HttpException(
        {
          code: ERROR_CODES.INVALID_CODE,
          message: 'Verification code not found or already used',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    return admin;
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException('Invalid email or password');
  }
}
