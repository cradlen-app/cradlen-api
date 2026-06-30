import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { StorageService } from '@infrastructure/storage/storage.service.js';
import type { AuthTokensDto } from '@core/auth/dto/auth-tokens.dto.js';
import { TokensService } from '@core/auth/services/tokens.service.js';
import type { PatientSignupStartDto } from './dto/patient-signup-start.dto.js';
import type { PatientSignupStartResponseDto } from './dto/patient-signup-start-response.dto.js';
import type { PatientSignupCompleteDto } from './dto/patient-signup-complete.dto.js';
import type { PatientLoginDto } from './dto/patient-login.dto.js';
import type { ChangePasswordDto } from './dto/change-password.dto.js';
import type { SetSecurityQuestionDto } from './dto/set-security-question.dto.js';
import type { PatientForgotPasswordStartDto } from './dto/patient-forgot-password-start.dto.js';
import type { PatientForgotPasswordStartResponseDto } from './dto/patient-forgot-password-start-response.dto.js';
import type { PatientForgotPasswordCompleteDto } from './dto/patient-forgot-password-complete.dto.js';
import type { RefreshDto } from '@core/auth/dto/refresh.dto.js';
import type { PatientMeResponseDto } from './dto/patient-me-response.dto.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';

const PASSWORD_BCRYPT_ROUNDS = 12;

/** The account fields `matchSubject` needs to gate signup vs. recovery. */
type MatchedAccount = {
  id: string;
  is_deleted: boolean;
  is_active: boolean;
  password_hashed: string | null;
  security_question: string | null;
  security_answer_hashed: string | null;
};

/**
 * Self-service registration + login for patients/guardians already on file.
 * Identity is proven by matching national_id + date_of_birth + phone_number
 * against an existing Patient/Guardian row (no OTP). A matched subject gets a
 * `PatientAccount` (dedicated portal-login table — never the staff `users`
 * table) linked via patient_id/guardian_id, and patient-scoped tokens. Every
 * failure path collapses into a single generic message so the endpoint can't be
 * used to enumerate which field was wrong.
 */
@Injectable()
export class PatientSignupService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly tokensService: TokensService,
    private readonly storageService: StorageService,
  ) {}

  async start(
    dto: PatientSignupStartDto,
  ): Promise<PatientSignupStartResponseDto> {
    const { subjectType, subjectId, account } = await this.matchSubject(dto);
    if (account) throw this.accountExists();
    return this.tokensService.issuePatientSignupToken(subjectType, subjectId);
  }

  /**
   * Resolves an identity triple (national_id + date_of_birth + phone_number) to
   * the matched Patient/Guardian subject and its linked account (if any).
   * Shared by signup/start (which requires NO account yet) and
   * forgot-password/start (which requires one). Every miss collapses into the
   * same generic `noMatch()` so neither endpoint can enumerate which field was
   * wrong.
   */
  private async matchSubject(dto: {
    national_id: string;
    date_of_birth: string;
    phone_number: string;
  }): Promise<{
    subjectType: 'PATIENT' | 'GUARDIAN';
    subjectId: string;
    account: MatchedAccount | null;
  }> {
    const dob = this.normalizeDob(dto.date_of_birth);
    const phone = dto.phone_number.trim();
    const accountSelect = {
      id: true,
      is_deleted: true,
      is_active: true,
      password_hashed: true,
      security_question: true,
      security_answer_hashed: true,
    } as const;

    const patient = await this.prismaService.db.patient.findFirst({
      where: { national_id: dto.national_id, is_deleted: false },
      include: { account: { select: accountSelect } },
    });
    if (patient) {
      if (
        !this.fieldsMatch(
          patient.date_of_birth,
          patient.phone_number,
          dob,
          phone,
        )
      ) {
        throw this.noMatch();
      }
      return {
        subjectType: 'PATIENT',
        subjectId: patient.id,
        account: patient.account,
      };
    }

    const guardian = await this.prismaService.db.guardian.findFirst({
      where: { national_id: dto.national_id, is_deleted: false },
      include: { account: { select: accountSelect } },
    });
    if (guardian) {
      // Guardians may pre-date the date_of_birth column; a null cannot match.
      if (!guardian.date_of_birth || !guardian.phone_number)
        throw this.noMatch();
      if (
        !this.fieldsMatch(
          guardian.date_of_birth,
          guardian.phone_number,
          dob,
          phone,
        )
      ) {
        throw this.noMatch();
      }
      return {
        subjectType: 'GUARDIAN',
        subjectId: guardian.id,
        account: guardian.account,
      };
    }

    throw this.noMatch();
  }

  async complete(dto: PatientSignupCompleteDto): Promise<AuthTokensDto> {
    const { subjectType, subjectId } =
      this.tokensService.decodePatientSignupToken(dto.patient_signup_token);
    const password_hashed = await bcrypt.hash(
      dto.password,
      PASSWORD_BCRYPT_ROUNDS,
    );
    const security_answer_hashed = await bcrypt.hash(
      this.normalizeSecurityAnswer(dto.security_answer),
      PASSWORD_BCRYPT_ROUNDS,
    );

    if (subjectType === 'PATIENT') {
      const patient = await this.prismaService.db.patient.findFirst({
        where: { id: subjectId, is_deleted: false },
        include: { account: { select: { id: true } } },
      });
      if (!patient) throw this.noMatch();
      if (patient.account) throw this.accountExists();
      const account = await this.createAccount({
        password_hashed,
        patient_id: patient.id,
        security_question: dto.security_question,
        security_answer_hashed,
      });
      return this.tokensService.issuePatientTokenPair({
        accountId: account.id,
        patientId: patient.id,
      });
    }

    const guardian = await this.prismaService.db.guardian.findFirst({
      where: { id: subjectId, is_deleted: false },
      include: { account: { select: { id: true } } },
    });
    if (!guardian) throw this.noMatch();
    if (guardian.account) throw this.accountExists();
    const account = await this.createAccount({
      password_hashed,
      guardian_id: guardian.id,
      security_question: dto.security_question,
      security_answer_hashed,
    });
    return this.tokensService.issuePatientTokenPair({
      accountId: account.id,
      guardianId: guardian.id,
    });
  }

  /**
   * Step 1 of password recovery. Verifies the identity triple and that a usable
   * account with a security question exists, then returns that question plus a
   * short-lived reset token. A missing/incomplete account collapses into the
   * same generic `noMatch()` as a wrong identity so the endpoint can't be used
   * to probe which national IDs have recoverable accounts.
   */
  async forgotPasswordStart(
    dto: PatientForgotPasswordStartDto,
  ): Promise<PatientForgotPasswordStartResponseDto> {
    const { account } = await this.matchSubject(dto);
    if (
      !account ||
      account.is_deleted ||
      !account.is_active ||
      !account.password_hashed ||
      !account.security_question ||
      !account.security_answer_hashed
    ) {
      throw this.noMatch();
    }

    const { reset_token, expires_in } =
      this.tokensService.issuePatientResetToken(account.id);
    return {
      security_question: account.security_question,
      reset_token,
      expires_in,
    };
  }

  /**
   * Step 2 of password recovery. The reset token (bound to an accountId) plus a
   * correct security answer authorize setting a new password. All existing
   * refresh tokens for the account are revoked so any active session dies. No
   * auto-login — the patient signs in fresh with the new password.
   */
  async forgotPasswordComplete(
    dto: PatientForgotPasswordCompleteDto,
  ): Promise<void> {
    const { accountId } = this.tokensService.decodePatientResetToken(
      dto.reset_token,
    );

    const account = await this.prismaService.db.patientAccount.findFirst({
      where: { id: accountId, is_active: true, is_deleted: false },
      select: { id: true, password_hashed: true, security_answer_hashed: true },
    });
    if (!account || !account.security_answer_hashed)
      throw this.invalidCredentials();

    const answerOk = await bcrypt.compare(
      this.normalizeSecurityAnswer(dto.security_answer),
      account.security_answer_hashed,
    );
    if (!answerOk) throw this.invalidCredentials();

    if (account.password_hashed) {
      const same = await bcrypt.compare(dto.password, account.password_hashed);
      if (same) {
        throw new BadRequestException(
          'New password must differ from the current password',
        );
      }
    }

    const password_hashed = await bcrypt.hash(
      dto.password,
      PASSWORD_BCRYPT_ROUNDS,
    );
    await this.prismaService.db.$transaction([
      this.prismaService.db.patientAccount.update({
        where: { id: account.id },
        // Stamp password_changed_at so the patient JWT strategy rejects access
        // tokens minted before this reset (refresh tokens revoked just below).
        data: { password_hashed, password_changed_at: new Date() },
      }),
      this.prismaService.db.refreshToken.updateMany({
        where: { patient_account_id: account.id, is_revoked: false },
        data: { is_revoked: true, revoked_at: new Date() },
      }),
    ]);
  }

  async login(dto: PatientLoginDto): Promise<AuthTokensDto> {
    const patient = await this.prismaService.db.patient.findFirst({
      where: { national_id: dto.national_id, is_deleted: false },
      select: { id: true, account: true },
    });

    let account = patient?.account ?? null;
    let patientId: string | undefined = patient?.id;
    let guardianId: string | undefined;

    if (!account) {
      patientId = undefined;
      const guardian = await this.prismaService.db.guardian.findFirst({
        where: { national_id: dto.national_id, is_deleted: false },
        select: { id: true, account: true },
      });
      account = guardian?.account ?? null;
      guardianId = guardian?.id;
    }

    if (
      !account ||
      account.is_deleted ||
      !account.is_active ||
      !account.password_hashed
    ) {
      throw this.invalidCredentials();
    }
    const ok = await bcrypt.compare(dto.password, account.password_hashed);
    if (!ok) throw this.invalidCredentials();

    return this.tokensService.issuePatientTokenPair({
      accountId: account.id,
      patientId,
      guardianId,
    });
  }

  /**
   * Exchanges a valid patient refresh token for a fresh access+refresh pair,
   * rotating the jti (old token is revoked atomically). The patient/guardian
   * subject is re-derived from the stored PatientAccount rather than trusting
   * the token.
   *
   * Concurrent-rotation grace: a client can fire two refreshes with the SAME
   * token nearly simultaneously (commonly across serverless instances, where an
   * in-process single-flight can't dedupe them). Strict rotation would 401 the
   * loser and kill an otherwise-valid session. So a token that was *rotated*
   * (replaced, not logged-out/reset) within {@link REFRESH_REUSE_GRACE_MS} is
   * honored with a fresh pair instead of being rejected. Reuse after the window,
   * or reuse of a token revoked by logout / password reset (no `replaced_by_jti`),
   * is still rejected.
   */
  private static readonly REFRESH_REUSE_GRACE_MS = 10_000;

  async refresh(dto: RefreshDto): Promise<AuthTokensDto> {
    const payload = this.tokensService.decodePatientRefreshToken(
      dto.refresh_token,
    );

    const stored = await this.prismaService.db.refreshToken.findUnique({
      where: { jti: payload.jti },
      include: { patientAccount: true },
    });
    if (!stored || stored.expires_at < new Date()) {
      throw new UnauthorizedException('Refresh token revoked or expired');
    }
    // A patient refresh row is owned by a PatientAccount, never a staff user.
    // Reject a staff row (no account / has user_id) defensively.
    if (!stored.patient_account_id || stored.user_id) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const matches = await bcrypt.compare(dto.refresh_token, stored.token_hash);
    if (!matches) throw new UnauthorizedException('Refresh token mismatch');

    const account = stored.patientAccount;
    if (!account || account.is_deleted || !account.is_active) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const subject = {
      accountId: account.id,
      patientId: account.patient_id ?? undefined,
      guardianId: account.guardian_id ?? undefined,
    };

    // Already rotated by a sibling request: honor within the grace window,
    // otherwise treat as reuse of a dead token.
    if (stored.is_revoked) {
      if (this.isRecentlyRotated(stored.replaced_by_jti, stored.revoked_at)) {
        return this.tokensService.issuePatientTokenPair(subject);
      }
      throw new UnauthorizedException('Refresh token revoked or expired');
    }

    try {
      return await this.tokensService.issuePatientTokenPair({
        ...subject,
        revokeJti: stored.jti,
      });
    } catch (error) {
      // Lost the atomic rotation race between findUnique and the guarded revoke:
      // a sibling rotated this jti microseconds ago. Same concurrent case —
      // re-issue a fresh pair rather than 401-ing the session.
      if (error instanceof UnauthorizedException) {
        return this.tokensService.issuePatientTokenPair(subject);
      }
      throw error;
    }
  }

  /** True when a revoked row was *rotated* (replaced) within the reuse grace. */
  private isRecentlyRotated(
    replacedByJti: string | null,
    revokedAt: Date | null,
  ): boolean {
    if (!replacedByJti || !revokedAt) return false;
    return (
      Date.now() - revokedAt.getTime() <=
      PatientSignupService.REFRESH_REUSE_GRACE_MS
    );
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokensService.revokeRefreshToken(refreshToken);
  }

  /**
   * Changes the logged-in account's password. The current password is verified
   * against the stored hash before the new one (which must differ) is written.
   * Keyed on the authenticated `accountId` — works for both patient and guardian
   * accounts (a guardian has its own PatientAccount credential).
   */
  async changePassword(
    ctx: PatientAuthContext,
    dto: ChangePasswordDto,
  ): Promise<void> {
    const account = await this.prismaService.db.patientAccount.findFirst({
      where: { id: ctx.accountId, is_active: true, is_deleted: false },
      select: { id: true, password_hashed: true },
    });
    if (!account || !account.password_hashed) {
      throw this.invalidCredentials();
    }

    const ok = await bcrypt.compare(
      dto.current_password,
      account.password_hashed,
    );
    if (!ok) throw this.invalidCredentials();

    const same = await bcrypt.compare(
      dto.new_password,
      account.password_hashed,
    );
    if (same) {
      throw new BadRequestException(
        'New password must differ from the current password',
      );
    }

    const password_hashed = await bcrypt.hash(
      dto.new_password,
      PASSWORD_BCRYPT_ROUNDS,
    );
    await this.prismaService.db.patientAccount.update({
      where: { id: account.id },
      data: { password_hashed },
    });
  }

  /**
   * Sets or replaces the logged-in account's security question + answer (used by
   * the portal profile page so accounts created before the feature — or anyone
   * wanting to change it — can enable/refresh recovery). The current password is
   * re-verified first so a hijacked session can't silently swap the recovery
   * credential. The answer is normalized then hashed; only the question key is
   * persisted in readable form.
   */
  async setSecurityQuestion(
    ctx: PatientAuthContext,
    dto: SetSecurityQuestionDto,
  ): Promise<void> {
    const account = await this.prismaService.db.patientAccount.findFirst({
      where: { id: ctx.accountId, is_active: true, is_deleted: false },
      select: { id: true, password_hashed: true },
    });
    if (!account || !account.password_hashed) {
      throw this.invalidCredentials();
    }

    const ok = await bcrypt.compare(
      dto.current_password,
      account.password_hashed,
    );
    if (!ok) throw this.invalidCredentials();

    const security_answer_hashed = await bcrypt.hash(
      this.normalizeSecurityAnswer(dto.security_answer),
      PASSWORD_BCRYPT_ROUNDS,
    );
    await this.prismaService.db.patientAccount.update({
      where: { id: account.id },
      data: {
        security_question: dto.security_question,
        security_answer_hashed,
      },
    });
  }

  /**
   * Resolves the request-scoped identity into a display name plus the
   * demographics of every patient the account may act on. Patient tokens can't
   * read the staff `GET /patients/:id`, so this is the portal's only source of
   * names. `relation` is "SELF" for the holder's own record, otherwise the
   * guardian→patient link's relation.
   */
  async me(ctx: PatientAuthContext): Promise<PatientMeResponseDto> {
    const account = await this.prismaService.db.patientAccount.findFirst({
      where: { id: ctx.accountId, is_deleted: false },
      select: { security_question: true },
    });

    let displayName = '';
    if (ctx.patientId) {
      const patient = await this.prismaService.db.patient.findFirst({
        where: { id: ctx.patientId, is_deleted: false },
        select: { full_name: true },
      });
      displayName = patient?.full_name ?? '';
    } else if (ctx.guardianId) {
      const guardian = await this.prismaService.db.guardian.findFirst({
        where: { id: ctx.guardianId, is_deleted: false },
        select: { full_name: true },
      });
      displayName = guardian?.full_name ?? '';
    }

    const patients = ctx.accessiblePatientIds.length
      ? await this.prismaService.db.patient.findMany({
          where: { id: { in: ctx.accessiblePatientIds }, is_deleted: false },
          select: {
            id: true,
            full_name: true,
            date_of_birth: true,
            profile_image_object_key: true,
            guardian_links: ctx.guardianId
              ? {
                  where: { guardian_id: ctx.guardianId },
                  select: { relation_to_patient: true },
                }
              : false,
          },
        })
      : [];

    const accessible_patients = await Promise.all(
      patients.map(async (p) => ({
        id: p.id,
        full_name: p.full_name,
        date_of_birth: this.normalizeDob(p.date_of_birth.toISOString()),
        relation:
          p.id === ctx.patientId
            ? 'SELF'
            : (p.guardian_links?.[0]?.relation_to_patient ?? 'OTHER'),
        profile_image_url: p.profile_image_object_key
          ? await this.storageService.createPresignedDownloadUrl(
              p.profile_image_object_key,
            )
          : null,
      })),
    );

    return {
      // `user_id` is the PatientAccount id (kept under this response key for
      // portal API stability — it's the identity id the client already uses).
      user_id: ctx.accountId,
      patient_id: ctx.patientId ?? null,
      guardian_id: ctx.guardianId ?? null,
      accessible_patient_ids: ctx.accessiblePatientIds,
      display_name: displayName,
      security_question: account?.security_question ?? null,
      accessible_patients,
    };
  }

  private createAccount(data: {
    password_hashed: string;
    patient_id?: string;
    guardian_id?: string;
    security_question: string;
    security_answer_hashed: string;
  }) {
    return this.prismaService.db.patientAccount
      .create({
        data: {
          password_hashed: data.password_hashed,
          patient_id: data.patient_id ?? null,
          guardian_id: data.guardian_id ?? null,
          security_question: data.security_question,
          security_answer_hashed: data.security_answer_hashed,
        },
        select: { id: true },
      })
      .catch((err: unknown) => {
        // Unique violation on patient_id/guardian_id => account already created
        // (e.g. two concurrent completes). Surface as a clean conflict.
        if (
          typeof err === 'object' &&
          err !== null &&
          (err as { code?: string }).code === 'P2002'
        ) {
          throw this.accountExists();
        }
        throw err;
      });
  }

  private fieldsMatch(
    storedDob: Date,
    storedPhone: string,
    dob: string,
    phone: string,
  ): boolean {
    return (
      this.normalizeDob(storedDob.toISOString()) === dob &&
      storedPhone.trim() === phone
    );
  }

  private normalizeDob(value: string): string {
    return new Date(value).toISOString().slice(0, 10);
  }

  /**
   * Canonicalizes a security answer before hashing/comparing so trivial
   * formatting differences ("Cairo " vs "cairo") don't lock a patient out.
   * Applied identically at capture (signup/complete) and verify (recovery).
   */
  private normalizeSecurityAnswer(raw: string): string {
    return raw.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private noMatch(): NotFoundException {
    return new NotFoundException('No matching record found');
  }

  private accountExists(): ConflictException {
    return new ConflictException('An account already exists for this record');
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException('Invalid credentials');
  }
}
