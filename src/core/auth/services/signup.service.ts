import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import type {
  JobFunction,
  Specialty,
  Subspecialty,
  User,
} from '@prisma/client';
import { ERROR_CODES } from '@common/constant/error-codes.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { resolveSubspecialties } from '@core/org/staff/staff.assertions.js';
import authConfig, { type AuthConfig } from '@config/auth.config.js';
import type { RegistrationStep } from '../dto/registration-status-response.dto.js';
import type { ResendOtpDto } from '../dto/resend-otp.dto.js';
import type { SignupCompleteDto } from '../dto/signup-complete.dto.js';
import type { SignupStartDto } from '../dto/signup-start.dto.js';
import type { SignupVerifyDto } from '../dto/signup-verify.dto.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { SpecialtyCatalogService } from '@core/org/specialty-catalog/specialty-catalog.public.js';
import { TokensService } from './tokens.service.js';
import { VerificationCodesService } from './verification-codes.service.js';
import {
  SessionsService,
  type ProfileSelectionResponse,
} from './sessions.service.js';
import {
  AUTH_EVENTS,
  type AuthSignupCompletedPayload,
} from '../events/auth.events.js';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class SignupService {
  private readonly authConfig: AuthConfig;

  constructor(
    private readonly prismaService: PrismaService,
    @Inject(authConfig.KEY)
    config: ConfigType<typeof authConfig>,
    private readonly tokensService: TokensService,
    private readonly verificationCodesService: VerificationCodesService,
    private readonly sessionsService: SessionsService,
    private readonly specialtiesService: SpecialtyCatalogService,
    private readonly eventBus: EventBus,
  ) {
    this.authConfig = config;
  }

  async start(dto: SignupStartDto) {
    const existing = await this.prismaService.db.user.findFirst({
      where: {
        // `users` is staff-only — patient/guardian self-signup accounts live in
        // the separate `patient_accounts` table, so there is no cross-space
        // collision to guard against here.
        OR: [
          { email: dto.email },
          ...(dto.phone_number ? [{ phone_number: dto.phone_number }] : []),
        ],
      },
    });
    if (existing) {
      // Reactivate a previously deleted user so they can re-join with a new
      // organization. Only when the email matches — a phone-only collision
      // must not reactivate a foreign identity or email someone else's OTP.
      //
      // Same treatment for a LIVE user with zero active memberships (e.g.
      // removed from their only org): they can neither sign in (empty profile
      // list) nor sign up (email conflict) otherwise. Reusing the User here
      // lets them re-onboard a fresh org. Gated by OTP just like reactivation,
      // so it opens no takeover vector a deleted-user reactivation didn't.
      const emailMatches = existing.email === dto.email;
      // A live, already-onboarded user with zero active memberships (e.g.
      // removed from their only org) is reused rather than 409'd. Guarded on
      // onboarding_completed so a verified-but-not-yet-onboarded user (mid
      // signup, no org yet — also profileless) still conflicts and resumes via
      // the login COMPLETE_ONBOARDING path. PENDING users keep their resume
      // path below; deleted users already take this branch.
      const isRemovedFromAllOrgs =
        emailMatches &&
        !existing.is_deleted &&
        existing.registration_status === 'ACTIVE' &&
        existing.onboarding_completed === true &&
        (await this.countActiveMemberships(existing.id)) === 0;
      if (emailMatches && (existing.is_deleted || isRemovedFromAllOrgs)) {
        const password_hashed = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
        // user.update + verificationCode.create commit together. The
        // email dispatch sits inside send() and holds the Prisma
        // connection open during the Resend roundtrip — acceptable
        // because reactivation is rare. The previous non-transactional
        // path could leave a reactivated user with no verification row
        // at all on a verificationCode.create failure (S-11).
        await this.prismaService.db.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: existing.id },
            data: {
              is_deleted: false,
              deleted_at: null,
              is_active: true,
              registration_status: 'PENDING',
              onboarding_completed: false,
              verified_at: null,
              first_name: dto.first_name,
              last_name: dto.last_name,
              password_hashed,
              phone_number: dto.phone_number ?? null,
              date_of_birth: dto.date_of_birth
                ? new Date(dto.date_of_birth)
                : null,
            },
          });
          await this.verificationCodesService.send(
            {
              userId: existing.id,
              target: dto.email,
              purpose: 'SIGNUP',
            },
            tx,
          );
        });
        return this.tokensService.issueSignupToken(existing.id, 'signup');
      }

      // Only resume a pending registration when the submitted email matches.
      if (
        existing.registration_status === 'PENDING' &&
        existing.email === dto.email
      ) {
        try {
          await this.resendOtp({ email: existing.email });
        } catch {
          // Swallow rate-limit errors — caller gets the token regardless.
        }
        return this.tokensService.issueSignupToken(existing.id, 'signup');
      }
      const conflictFields = [
        ...(existing.email === dto.email ? ['email'] : []),
        ...(dto.phone_number && existing.phone_number === dto.phone_number
          ? ['phone_number']
          : []),
      ];
      throw new ConflictException({
        message: 'User already exists',
        code: ERROR_CODES.CONFLICT,
        details: { fields: conflictFields },
      });
    }

    const password_hashed = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.prismaService.db.user.create({
      data: {
        first_name: dto.first_name,
        last_name: dto.last_name,
        email: dto.email,
        phone_number: dto.phone_number,
        date_of_birth: dto.date_of_birth ? new Date(dto.date_of_birth) : null,
        password_hashed,
        registration_status: 'PENDING',
        onboarding_completed: false,
      },
    });

    await this.verificationCodesService.send({
      userId: user.id,
      target: dto.email,
      purpose: 'SIGNUP',
    });

    return this.tokensService.issueSignupToken(user.id, 'signup');
  }

  async verify(dto: SignupVerifyDto) {
    const userId = this.tokensService.decodeSignupToken(
      dto.signup_token,
      'signup',
    );
    const user = await this.prismaService.db.user.findFirst({
      where: { id: userId, is_deleted: false },
    });
    if (!user?.email) throw new UnauthorizedException('User not found');
    if (user.registration_status !== 'PENDING') {
      throw new ConflictException('Email already verified');
    }

    await this.verificationCodesService.consume({
      userId,
      target: user.email,
      purpose: 'SIGNUP',
      code: dto.code,
    });

    await this.prismaService.db.user.update({
      where: { id: userId },
      data: {
        verified_at: new Date(),
        registration_status: 'ACTIVE',
        is_active: true,
      },
    });

    return this.tokensService.issueSignupToken(userId, 'signup');
  }

  async complete(dto: SignupCompleteDto): Promise<ProfileSelectionResponse> {
    const userId = this.tokensService.decodeSignupToken(
      dto.signup_token,
      'signup',
    );
    const user = await this.prismaService.db.user.findFirst({
      where: { id: userId, is_deleted: false, is_active: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.registration_status !== 'ACTIVE' || !user.verified_at) {
      throw new ForbiddenException('Signup has not been verified');
    }

    const jobFunctions = await this.resolveJobFunctions(
      dto.job_function_code ? [dto.job_function_code] : [],
    );
    // Silent-skip on unmatched org entries: the offering list should not
    // hard-fail onboarding on a stale specialty label. `specialties` describes
    // what the organization offers; `practitioner_specialty_code` is the owner's
    // own single primary specialty, set only when they also practice.
    const orgSpecialties = await this.specialtiesService.resolveByCodeOrName(
      dto.specialties,
    );
    const practitionerSpecialty = dto.practitioner_specialty_code
      ? ((
          await this.specialtiesService.resolveByCodeOrName([
            dto.practitioner_specialty_code,
          ])
        )[0] ?? null)
      : null;
    // Subspecialties are validated strictly (must exist and belong to the
    // owner's specialty) — they are new and fully FE-controlled.
    const practitionerSubspecialties = await resolveSubspecialties(
      this.prismaService,
      dto.practitioner_subspecialty_codes,
      practitionerSpecialty?.id ?? null,
    );

    const [ownerRole, freePlan] = await Promise.all([
      this.findRole('OWNER'),
      this.prismaService.db.subscriptionPlan.findUnique({
        where: { plan: 'free_trial' },
      }),
    ]);
    if (!freePlan)
      throw new InternalServerErrorException('Free trial plan not seeded');

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + this.authConfig.freeTrialDays);

    const { organizationId, profileId } = await this.runOnboardingTransaction({
      userId,
      dto,
      jobFunctions,
      orgSpecialties,
      practitionerSpecialty,
      practitionerSubspecialties,
      ownerRoleId: ownerRole.id,
      freePlanId: freePlan.id,
      trialEndsAt,
    });

    if (user.email) {
      const payload: AuthSignupCompletedPayload = {
        user_id: userId,
        organization_id: organizationId,
        profile_id: profileId,
        email: user.email,
        completed_at: new Date(),
      };
      this.eventBus.publish(AUTH_EVENTS.signup.completed, payload);
    }

    return this.sessionsService.buildProfileSelectionResponse(userId);
  }

  async resendOtp(dto: ResendOtpDto) {
    const user = await this.prismaService.db.user.findFirst({
      where: { email: dto.email, is_deleted: false },
    });
    if (!user) return { success: true as const };
    if (user.registration_status !== 'PENDING') {
      throw new ConflictException('Registration is not pending');
    }

    await this.verificationCodesService.assertCanResend({
      userId: user.id,
      purpose: 'SIGNUP',
    });

    await this.verificationCodesService.send({
      userId: user.id,
      target: dto.email,
      purpose: 'SIGNUP',
      isResend: true,
    });

    return { success: true as const };
  }

  async getRegistrationStatus(input: {
    email?: string;
    authorization?: string;
  }): Promise<{ step: RegistrationStep; email?: string }> {
    const tokenUserId = this.tokensService.tryDecodeAccessToken(
      input.authorization,
    );
    if (tokenUserId) {
      const user = await this.prismaService.db.user.findFirst({
        where: { id: tokenUserId, is_deleted: false },
      });
      if (!user) return { step: 'NONE' };
      return {
        step: await this.resolveStepForUser(user),
        ...(user.email ? { email: user.email } : {}),
      };
    }

    if (!input.email) {
      if (input.authorization) {
        throw new UnauthorizedException('Invalid or expired token');
      }
      throw new BadRequestException('email is required');
    }

    const user = await this.prismaService.db.user.findFirst({
      where: { email: input.email, is_deleted: false },
    });
    if (!user) return { step: 'NONE' };
    return { step: await this.resolveStepForUser(user) };
  }

  private resolveRegistrationStep(
    user: Pick<User, 'registration_status' | 'onboarding_completed'>,
  ): RegistrationStep {
    if (user.onboarding_completed) return 'DONE';
    if (user.registration_status === 'PENDING') return 'VERIFY_OTP';
    return 'COMPLETE_ONBOARDING';
  }

  /**
   * Membership-aware step. A user who onboarded before but has since been
   * removed from all their organizations (0 active profiles) reports `DONE` by
   * the pure rule above, yet still needs to create a new org — mirror the login
   * funnel (`sessions.service.buildLoginResponse`) so `registration/status`,
   * login, and `signup/start` agree, and the FE step-3 guard keeps them on
   * `/sign-up/complete` instead of bouncing them to `/sign-in`.
   */
  private async resolveStepForUser(
    user: Pick<User, 'id' | 'registration_status' | 'onboarding_completed'>,
  ): Promise<RegistrationStep> {
    const base = this.resolveRegistrationStep(user);
    if (base !== 'DONE') return base;
    const active = await this.countActiveMemberships(user.id);
    return active === 0 ? 'COMPLETE_ONBOARDING' : 'DONE';
  }

  /** Count of the user's live memberships (active profile in a live, active
   * org) — the shared "does this user still belong anywhere" predicate used by
   * both `start()` and `resolveStepForUser`. */
  private countActiveMemberships(userId: string): Promise<number> {
    return this.prismaService.db.profile.count({
      where: {
        user_id: userId,
        is_deleted: false,
        is_active: true,
        organization: { is_deleted: false, status: 'ACTIVE' },
      },
    });
  }

  private async resolveJobFunctions(codes: string[]): Promise<JobFunction[]> {
    const unique = [...new Set(codes)];
    if (unique.length === 0) return [];
    const rows = await this.prismaService.db.jobFunction.findMany({
      where: { code: { in: unique } },
    });
    if (rows.length !== unique.length) {
      const found = new Set(rows.map((jf) => jf.code));
      const missing = unique.filter((c) => !found.has(c));
      throw new BadRequestException(
        `Unknown job_function_codes: ${missing.join(', ')}`,
      );
    }
    return rows;
  }

  private async findRole(name: string) {
    const role = await this.prismaService.db.role.findUnique({
      where: { name },
    });
    if (!role)
      throw new InternalServerErrorException(`${name} role not seeded`);
    return role;
  }

  private async runOnboardingTransaction(args: {
    userId: string;
    dto: SignupCompleteDto;
    jobFunctions: JobFunction[];
    orgSpecialties: Specialty[];
    practitionerSpecialty: Specialty | null;
    practitionerSubspecialties: Subspecialty[];
    ownerRoleId: string;
    freePlanId: string;
    trialEndsAt: Date;
  }): Promise<{ organizationId: string; profileId: string }> {
    const {
      userId,
      dto,
      jobFunctions,
      orgSpecialties,
      practitionerSpecialty,
      practitionerSubspecialties,
      ownerRoleId,
      freePlanId,
      trialEndsAt,
    } = args;

    return this.prismaService.db.$transaction(async (tx) => {
      // Atomically claim onboarding. If another concurrent request already
      // claimed it, updateMany returns count=0 and we abort before creating
      // any tenant records — prevents duplicate organization/profile rows.
      const claimed = await tx.user.updateMany({
        where: {
          id: userId,
          registration_status: 'ACTIVE',
          verified_at: { not: null },
          onboarding_completed: false,
        },
        data: { onboarding_completed: true },
      });
      if (claimed.count === 0) {
        throw new ConflictException('Onboarding already completed');
      }

      const organization = await tx.organization.create({
        data: {
          name: dto.organization_name,
          specialty_links: orgSpecialties.length
            ? { create: orgSpecialties.map((s) => ({ specialty_id: s.id })) }
            : undefined,
        },
      });
      const branch = await tx.branch.create({
        data: {
          organization_id: organization.id,
          name: dto.branch_name,
          address: dto.branch_address,
          city: dto.branch_city,
          governorate: dto.branch_governorate,
          country: dto.branch_country,
          is_main: true,
        },
      });
      const profile = await tx.profile.create({
        data: {
          user_id: userId,
          organization_id: organization.id,
          executive_title: dto.executive_title ?? null,
          professional_title: dto.professional_title ?? null,
          engagement_type: dto.engagement_type ?? 'FULL_TIME',
          role_id: ownerRoleId,
          job_function_id: jobFunctions[0]?.id ?? null,
          // The owner's own primary specialty (only when they practice) —
          // distinct from the organization's offered specialties above.
          specialty_id: practitionerSpecialty?.id ?? null,
          // Link the owner to the main branch so they appear in the branch-scoped
          // staff list and stats; without this the owner is silently excluded.
          branches: {
            create: [
              { organization_id: organization.id, branch_id: branch.id },
            ],
          },
          subspecialty_links: practitionerSubspecialties.length
            ? {
                create: practitionerSubspecialties.map((s) => ({
                  subspecialty_id: s.id,
                })),
              }
            : undefined,
        },
      });
      await tx.subscription.create({
        data: {
          organization_id: organization.id,
          subscription_plan_id: freePlanId,
          trial_ends_at: trialEndsAt,
        },
      });
      return { organizationId: organization.id, profileId: profile.id };
    });
  }
}
