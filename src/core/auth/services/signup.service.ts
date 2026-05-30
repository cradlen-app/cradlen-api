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
import type { JobFunction, Specialty, User } from '@prisma/client';
import { ERROR_CODES } from '@common/constant/error-codes.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import authConfig, { type AuthConfig } from '@config/auth.config.js';
import type { RegistrationStep } from '../dto/registration-status-response.dto.js';
import type { ResendOtpDto } from '../dto/resend-otp.dto.js';
import type { SignupCompleteDto } from '../dto/signup-complete.dto.js';
import type { SignupStartDto } from '../dto/signup-start.dto.js';
import type { SignupVerifyDto } from '../dto/signup-verify.dto.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { SpecialtiesService } from '@core/org/specialties/specialties.public.js';
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
    private readonly specialtiesService: SpecialtiesService,
    private readonly eventBus: EventBus,
  ) {
    this.authConfig = config;
  }

  async start(dto: SignupStartDto) {
    const existing = await this.prismaService.db.user.findFirst({
      where: {
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
      if (existing.is_deleted && existing.email === dto.email) {
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
      dto.job_function_codes ?? [],
    );
    // Silent-skip on unmatched entries: the M2M is the source of truth and
    // onboarding should not hard-fail on a stale specialty label.
    const specialties = await this.specialtiesService.resolveByCodeOrName(
      dto.specialties,
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
      specialties,
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
        step: this.resolveRegistrationStep(user),
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
    return { step: this.resolveRegistrationStep(user) };
  }

  private resolveRegistrationStep(
    user: Pick<User, 'registration_status' | 'onboarding_completed'>,
  ): RegistrationStep {
    if (user.onboarding_completed) return 'DONE';
    if (user.registration_status === 'PENDING') return 'VERIFY_OTP';
    return 'COMPLETE_ONBOARDING';
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
    specialties: Specialty[];
    ownerRoleId: string;
    freePlanId: string;
    trialEndsAt: Date;
  }): Promise<{ organizationId: string; profileId: string }> {
    const {
      userId,
      dto,
      jobFunctions,
      specialties,
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
          specialty_links: specialties.length
            ? { create: specialties.map((s) => ({ specialty_id: s.id })) }
            : undefined,
        },
      });
      await tx.branch.create({
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
          engagement_type: dto.engagement_type ?? 'FULL_TIME',
          roles: { create: [{ role_id: ownerRoleId }] },
          job_functions: jobFunctions.length
            ? {
                create: jobFunctions.map((jf) => ({
                  job_function_id: jf.id,
                })),
              }
            : undefined,
          specialty_links: specialties.length
            ? { create: specialties.map((s) => ({ specialty_id: s.id })) }
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
