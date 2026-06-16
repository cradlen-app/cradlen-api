import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import * as bcrypt from 'bcryptjs';
import { InvitationStatus, Prisma } from '@prisma/client';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import appConfig, { type AppConfig } from '@config/app.config.js';
import authConfig, { type AuthConfig } from '@config/auth.config.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EmailService } from '@infrastructure/email/email.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import { persistSchedules } from '../staff/schedule.helpers.js';
import {
  assertBranchesInOrganization,
  assertRolesExist,
  assertScheduleBranches,
  assertShiftTimes,
  resolveJobFunctionsAndSpecialties,
} from '../staff/staff.assertions.js';
import type {
  AcceptInvitationDto,
  CreateInvitationDto,
  DeclineInvitationDto,
  PreviewInvitationQueryDto,
} from './dto/invitation.dto.js';
import { InvitationAcceptedEvent } from './events/invitation-accepted.event.js';
import { InvitationDeclinedEvent } from './events/invitation-declined.event.js';
import {
  INVITATION_FULL_INCLUDE,
  INVITATION_PREVIEW_INCLUDE,
  type InvitationFull,
} from './invitations.includes.js';
import {
  toInvitationPreviewResponse,
  toInvitationResponse,
} from './invitations.mapper.js';
import {
  buildInvitationAcceptUrl,
  generateInvitationToken,
} from './invitations.tokens.js';
import {
  assertInvitationRedeemable,
  assertNotSelfInvite,
} from './invitations.assertions.js';

@Injectable()
export class InvitationsService {
  private readonly appConfig: AppConfig;
  private readonly authConfig: AuthConfig;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly mailService: EmailService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly eventBus: EventBus,
    @Inject(appConfig.KEY)
    app: ConfigType<typeof appConfig>,
    @Inject(authConfig.KEY)
    auth: ConfigType<typeof authConfig>,
  ) {
    this.appConfig = app;
    this.authConfig = auth;
  }

  async createInvitation(
    currentUserId: string,
    profileId: string,
    organizationId: string,
    branchId: string,
    dto: CreateInvitationDto,
  ) {
    const uniqueBranchIds = [...new Set(dto.branch_ids)];
    const roleId = dto.role_id;

    if (!uniqueBranchIds.includes(branchId)) {
      throw new BadRequestException(
        'branch_ids must include the path branchId',
      );
    }

    await this.authorizationService.assertCanManageStaffOnBranches(
      profileId,
      organizationId,
      uniqueBranchIds,
    );
    await this.authorizationService.assertNoPrivilegedRoleAssignment(
      profileId,
      organizationId,
      roleId,
    );
    await this.subscriptionsService.assertStaffLimit(organizationId);
    await assertNotSelfInvite(this.prismaService, currentUserId, [dto.email]);

    const prepared = await this.prepareInvitationData(organizationId, dto);

    let invitation: InvitationFull;
    try {
      invitation = await this.prismaService.db.invitation.create({
        data: this.buildInvitationCreateData(
          organizationId,
          currentUserId,
          dto,
          prepared,
        ),
        include: INVITATION_FULL_INCLUDE,
      });
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Pending invitation already exists for this email',
        );
      }
      throw err;
    }

    const inviteUrl = buildInvitationAcceptUrl(
      this.appConfig,
      invitation.id,
      prepared.rawToken,
    );
    await this.mailService.sendStaffInvitationEmail(dto.email, inviteUrl);
    return toInvitationResponse(invitation);
  }

  private async prepareInvitationData(
    organizationId: string,
    dto: CreateInvitationDto,
  ) {
    const roleId = dto.role_id;
    const uniqueBranchIds = [...new Set(dto.branch_ids)];
    const jobFunctionCodes = dto.job_function_code
      ? [dto.job_function_code]
      : [];
    const specialtyCodes = [...new Set(dto.specialty_codes ?? [])];

    await Promise.all([
      assertBranchesInOrganization(
        this.prismaService,
        organizationId,
        uniqueBranchIds,
      ),
      assertRolesExist(this.prismaService, [roleId]),
    ]);

    const { jobFunctions, specialties } =
      await resolveJobFunctionsAndSpecialties(
        this.prismaService,
        jobFunctionCodes,
        specialtyCodes,
      );

    const { rawToken, tokenHash, expiresAt } = generateInvitationToken(
      this.authConfig,
    );

    return {
      roleId,
      uniqueBranchIds,
      jobFunctions,
      specialties,
      rawToken,
      tokenHash,
      expiresAt,
    };
  }

  private buildInvitationCreateData(
    organizationId: string,
    currentUserId: string,
    dto: CreateInvitationDto,
    prepared: Awaited<ReturnType<InvitationsService['prepareInvitationData']>>,
  ): Prisma.InvitationCreateInput {
    return {
      organization: { connect: { id: organizationId } },
      invited_by: { connect: { id: currentUserId } },
      email: dto.email,
      first_name: dto.first_name,
      last_name: dto.last_name,
      phone_number: dto.phone_number,
      executive_title: dto.executive_title ?? null,
      professional_title: dto.professional_title ?? null,
      engagement_type: dto.engagement_type ?? 'FULL_TIME',
      token_hash: prepared.tokenHash,
      expires_at: prepared.expiresAt,
      role: { connect: { id: prepared.roleId } },
      branches: {
        create: prepared.uniqueBranchIds.map((branch_id) => ({
          branch_id,
          organization_id: organizationId,
        })),
      },
      job_function: prepared.jobFunctions[0]
        ? { connect: { id: prepared.jobFunctions[0].id } }
        : undefined,
      specialty_links: prepared.specialties.length
        ? {
            create: prepared.specialties.map((s) => ({ specialty_id: s.id })),
          }
        : undefined,
    };
  }

  async listInvitations(
    profileId: string,
    organizationId: string,
    branchId: string,
  ) {
    await this.authorizationService.assertCanManageStaffOnBranches(
      profileId,
      organizationId,
      [branchId],
    );
    const invitations = await this.prismaService.db.invitation.findMany({
      where: {
        organization_id: organizationId,
        is_deleted: false,
        branches: { some: { branch_id: branchId } },
      },
      include: INVITATION_FULL_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
    return invitations.map((item) => toInvitationResponse(item));
  }

  async acceptInvitation(dto: AcceptInvitationDto) {
    const invitation = await this.validateAcceptance(dto);
    await this.verifyExistingUserCredentials(invitation.email, dto.password);
    const passwordHash = await bcrypt.hash(dto.password, 12);

    const result = await this.prismaService.db.$transaction((tx) =>
      this.claimAndProvision(tx, invitation, dto, passwordHash),
    );

    await this.emitAccepted(invitation);
    return result;
  }

  private async validateAcceptance(
    dto: AcceptInvitationDto,
  ): Promise<InvitationFull> {
    const invitation = await this.prismaService.db.invitation.findFirst({
      where: { id: dto.invitation_id, is_deleted: false },
      include: INVITATION_FULL_INCLUDE,
    });
    if (!invitation) throw new UnauthorizedException('Invalid invitation');

    await assertInvitationRedeemable(invitation, dto.token);

    if (dto.schedule?.length) {
      assertScheduleBranches(
        dto.schedule,
        invitation.branches.map((b) => b.branch_id),
      );
      assertShiftTimes(dto.schedule);
    }
    return invitation;
  }

  private async verifyExistingUserCredentials(
    email: string,
    rawPassword: string,
  ): Promise<void> {
    const existingUser = await this.prismaService.db.user.findFirst({
      where: { email, is_deleted: false },
      select: { password_hashed: true },
    });
    if (!existingUser?.password_hashed) return;
    const matches = await bcrypt.compare(
      rawPassword,
      existingUser.password_hashed,
    );
    if (!matches) throw new UnauthorizedException('Invalid credentials');
  }

  private async claimAndProvision(
    tx: Prisma.TransactionClient,
    invitation: InvitationFull,
    dto: AcceptInvitationDto,
    passwordHash: string,
  ): Promise<{
    user_id: string;
    profile_id: string;
    organization_id: string;
  }> {
    const claimed = await tx.invitation.updateMany({
      where: {
        id: invitation.id,
        status: InvitationStatus.PENDING,
        accepted_at: null,
        expires_at: { gt: new Date() },
      },
      data: { status: InvitationStatus.ACCEPTED, accepted_at: new Date() },
    });
    if (claimed.count !== 1)
      throw new ConflictException('Invitation already accepted');

    await this.subscriptionsService.assertStaffLimit(
      invitation.organization_id,
      tx,
    );

    let user = await tx.user.findFirst({
      where: { email: invitation.email, is_deleted: false },
    });
    if (!user) {
      user = await tx.user.create({
        data: {
          first_name: dto.first_name ?? invitation.first_name,
          last_name: dto.last_name ?? invitation.last_name,
          email: invitation.email,
          phone_number: invitation.phone_number,
          password_hashed: passwordHash,
          registration_status: 'ACTIVE',
          onboarding_completed: true,
          verified_at: new Date(),
        },
      });
    }

    const profile = await tx.profile.upsert({
      where: {
        user_id_organization_id: {
          user_id: user.id,
          organization_id: invitation.organization_id,
        },
      },
      update: {
        is_active: true,
        is_deleted: false,
        deleted_at: null,
        role_id: invitation.role_id,
        job_function_id: invitation.job_function_id,
        executive_title: invitation.executive_title,
        professional_title: invitation.professional_title,
        engagement_type: invitation.engagement_type,
      },
      create: {
        user_id: user.id,
        organization_id: invitation.organization_id,
        role_id: invitation.role_id,
        job_function_id: invitation.job_function_id,
        executive_title: invitation.executive_title,
        professional_title: invitation.professional_title,
        engagement_type: invitation.engagement_type,
      },
    });

    await this.assignProfileAccess(tx, profile.id, invitation);

    if (dto.schedule?.length) {
      await persistSchedules(tx, profile.id, dto.schedule);
    }

    return {
      user_id: user.id,
      profile_id: profile.id,
      organization_id: invitation.organization_id,
    };
  }

  private async emitAccepted(invitation: InvitationFull): Promise<void> {
    const recipientProfileId = await this.resolveInviterProfileId(
      invitation.invited_by_id,
      invitation.organization_id,
    );
    if (!recipientProfileId) return;

    this.eventBus.publish(
      'invitation.accepted',
      new InvitationAcceptedEvent({
        invitationId: invitation.id,
        recipientProfileId,
        inviteeName: `${invitation.first_name} ${invitation.last_name}`,
        organizationId: invitation.organization_id,
        branchId: invitation.branches[0]?.branch_id ?? null,
      }),
    );
  }

  /**
   * Resolves the inviter's Profile within the invitation's organization.
   * Notifications are profile-scoped, so the inviter (identified by user) must
   * be mapped to their membership in that org. Returns null when no active
   * profile exists (e.g. the inviter left the org) — the caller skips emitting.
   */
  private async resolveInviterProfileId(
    userId: string,
    organizationId: string,
  ): Promise<string | null> {
    const profile = await this.prismaService.db.profile.findFirst({
      where: {
        user_id: userId,
        organization_id: organizationId,
        is_deleted: false,
      },
      select: { id: true },
    });
    return profile?.id ?? null;
  }

  async getInvitation(
    profileId: string,
    organizationId: string,
    branchId: string,
    invitationId: string,
  ) {
    await this.authorizationService.assertCanManageStaffOnBranches(
      profileId,
      organizationId,
      [branchId],
    );
    const invitation = await this.prismaService.db.invitation.findFirst({
      where: {
        id: invitationId,
        organization_id: organizationId,
        is_deleted: false,
        branches: { some: { branch_id: branchId } },
      },
      include: INVITATION_FULL_INCLUDE,
    });
    if (!invitation) throw new NotFoundException('Invitation not found');

    let workingSchedule = null;
    if (invitation.status === InvitationStatus.ACCEPTED) {
      const user = await this.prismaService.db.user.findFirst({
        where: { email: invitation.email, is_deleted: false },
        select: { id: true },
      });
      if (user) {
        const profile = await this.prismaService.db.profile.findFirst({
          where: {
            user_id: user.id,
            organization_id: organizationId,
            is_deleted: false,
          },
          select: { id: true },
        });
        if (profile) {
          workingSchedule = await this.fetchWorkingSchedule(profile.id);
        }
      }
    }

    return toInvitationResponse(invitation, workingSchedule);
  }

  async resendInvitation(
    profileId: string,
    organizationId: string,
    branchId: string,
    invitationId: string,
  ) {
    await this.authorizationService.assertCanManageStaffOnBranches(
      profileId,
      organizationId,
      [branchId],
    );
    const invitation = await this.prismaService.db.invitation.findFirst({
      where: {
        id: invitationId,
        organization_id: organizationId,
        is_deleted: false,
        branches: { some: { branch_id: branchId } },
      },
      include: { branches: { select: { branch_id: true } } },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.status !== InvitationStatus.PENDING)
      throw new BadRequestException('Only pending invitations can be resent');

    const { rawToken, tokenHash, expiresAt } = generateInvitationToken(
      this.authConfig,
    );

    await this.prismaService.db.invitation.update({
      where: { id: invitationId },
      data: { token_hash: tokenHash, expires_at: expiresAt },
    });

    const inviteUrl = buildInvitationAcceptUrl(
      this.appConfig,
      invitation.id,
      rawToken,
    );
    await this.mailService.sendStaffInvitationEmail(
      invitation.email,
      inviteUrl,
    );
  }

  async cancelInvitation(
    profileId: string,
    organizationId: string,
    branchId: string,
    invitationId: string,
  ) {
    await this.authorizationService.assertCanManageStaffOnBranches(
      profileId,
      organizationId,
      [branchId],
    );
    const invitation = await this.prismaService.db.invitation.findFirst({
      where: {
        id: invitationId,
        organization_id: organizationId,
        is_deleted: false,
        branches: { some: { branch_id: branchId } },
      },
      include: INVITATION_FULL_INCLUDE,
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    const updated = await this.prismaService.db.invitation.update({
      where: { id: invitationId },
      data: {
        is_deleted: true,
        deleted_at: new Date(),
        ...(invitation.status === InvitationStatus.PENDING && {
          status: InvitationStatus.CANCELLED,
        }),
      },
      include: INVITATION_FULL_INCLUDE,
    });
    return toInvitationResponse(updated);
  }

  private async assignProfileAccess(
    tx: Prisma.TransactionClient,
    profileId: string,
    invitation: InvitationFull,
  ) {
    await Promise.all([
      tx.profileBranch.createMany({
        data: invitation.branches.map((item) => ({
          profile_id: profileId,
          branch_id: item.branch_id,
          organization_id: invitation.organization_id,
        })),
        skipDuplicates: true,
      }),
      invitation.specialty_links.length
        ? tx.profileSpecialty.createMany({
            data: invitation.specialty_links.map((item) => ({
              profile_id: profileId,
              specialty_id: item.specialty_id,
            })),
            skipDuplicates: true,
          })
        : Promise.resolve(),
    ]);
  }

  async declineInvitation(dto: DeclineInvitationDto) {
    const invitation = await this.prismaService.db.invitation.findFirst({
      where: { id: dto.invitation_id, is_deleted: false },
      select: {
        id: true,
        status: true,
        token_hash: true,
        expires_at: true,
        invited_by_id: true,
        first_name: true,
        last_name: true,
        organization_id: true,
        branches: { select: { branch_id: true } },
      },
    });

    if (!invitation) throw new UnauthorizedException('Invalid invitation');

    await assertInvitationRedeemable(invitation, dto.token);

    await this.prismaService.db.invitation.update({
      where: { id: invitation.id },
      data: { status: InvitationStatus.CANCELLED },
    });

    const recipientProfileId = await this.resolveInviterProfileId(
      invitation.invited_by_id,
      invitation.organization_id,
    );
    if (recipientProfileId) {
      this.eventBus.publish(
        'invitation.declined',
        new InvitationDeclinedEvent({
          invitationId: invitation.id,
          recipientProfileId,
          inviteeName: `${invitation.first_name} ${invitation.last_name}`,
          organizationId: invitation.organization_id,
          branchId: invitation.branches[0]?.branch_id ?? null,
        }),
      );
    }

    return { message: 'Invitation declined' };
  }

  async previewInvitation(dto: PreviewInvitationQueryDto) {
    const invitation = await this.prismaService.db.invitation.findFirst({
      where: { id: dto.invitation_id, is_deleted: false },
      include: INVITATION_PREVIEW_INCLUDE,
    });

    if (!invitation) throw new UnauthorizedException('Invalid invitation');

    await assertInvitationRedeemable(invitation, dto.token);

    return toInvitationPreviewResponse(invitation);
  }

  private fetchWorkingSchedule(profileId: string) {
    return this.prismaService.db.workingSchedule.findMany({
      where: { profile_id: profileId },
      include: {
        branch: { select: { id: true, name: true } },
        days: { include: { shifts: true } },
      },
    });
  }
}
