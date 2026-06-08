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
  BulkCreateInvitationsDto,
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
    const uniqueRoleIds = [...new Set(dto.role_ids)];

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
      uniqueRoleIds,
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

  async bulkCreateInvitations(
    currentUserId: string,
    profileId: string,
    organizationId: string,
    branchId: string,
    dto: BulkCreateInvitationsDto,
  ) {
    // Cheap, fail-fast checks first: self-invite and the path/branch invariant.
    await assertNotSelfInvite(
      this.prismaService,
      currentUserId,
      dto.invitations.map((i) => i.email),
    );

    // Per-row branch/role checks: every invitation in the batch must be
    // within the caller's scope and include the path branchId in branch_ids.
    // Done up-front so the whole batch fails fast rather than partially
    // before the transaction opens.
    for (const item of dto.invitations) {
      const branchIds = [...new Set(item.branch_ids)];
      const roleIds = [...new Set(item.role_ids)];
      if (!branchIds.includes(branchId)) {
        throw new BadRequestException(
          'Every invitation must include the path branchId in branch_ids',
        );
      }
      await this.authorizationService.assertCanManageStaffOnBranches(
        profileId,
        organizationId,
        branchIds,
      );
      await this.authorizationService.assertNoPrivilegedRoleAssignment(
        profileId,
        organizationId,
        roleIds,
      );
    }

    // Subscription limit gate. The accept-flow re-checks the limit per acceptance,
    // so a batch larger than remaining capacity will create invitations that simply
    // can't all be redeemed; that's acceptable behavior.
    await this.subscriptionsService.assertStaffLimit(organizationId);

    const prepared = await Promise.all(
      dto.invitations.map((item) =>
        this.prepareInvitationData(organizationId, item),
      ),
    );

    let createdIds: string[];
    try {
      createdIds = await this.prismaService.db.$transaction(async (tx) =>
        Promise.all(
          dto.invitations.map(async (item, idx) => {
            const created = await tx.invitation.create({
              data: this.buildInvitationCreateData(
                organizationId,
                currentUserId,
                item,
                prepared[idx],
              ),
              select: { id: true },
            });
            return created.id;
          }),
        ),
      );
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'One or more invitations already exist for the given emails',
        );
      }
      throw err;
    }

    // Send emails after commit. Individual failures are logged and returned
    // in the response so the caller can decide whether to resend.
    const emailResults = await Promise.all(
      dto.invitations.map(async (item, idx) => {
        const id = createdIds[idx];
        const inviteUrl = buildInvitationAcceptUrl(
          this.appConfig,
          id,
          prepared[idx].rawToken,
        );
        try {
          await this.mailService.sendStaffInvitationEmail(
            item.email,
            inviteUrl,
          );
          return { id, email: item.email, email_sent: true as const };
        } catch {
          return { id, email: item.email, email_sent: false as const };
        }
      }),
    );

    return {
      created: emailResults.length,
      results: emailResults,
    };
  }

  private async prepareInvitationData(
    organizationId: string,
    dto: CreateInvitationDto,
  ) {
    const uniqueRoleIds = [...new Set(dto.role_ids)];
    const uniqueBranchIds = [...new Set(dto.branch_ids)];
    const jobFunctionCodes = [...new Set(dto.job_function_codes ?? [])];
    const specialtyCodes = [...new Set(dto.specialty_codes ?? [])];

    await Promise.all([
      assertBranchesInOrganization(
        this.prismaService,
        organizationId,
        uniqueBranchIds,
      ),
      assertRolesExist(this.prismaService, uniqueRoleIds),
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
      uniqueRoleIds,
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
      engagement_type: dto.engagement_type ?? 'FULL_TIME',
      token_hash: prepared.tokenHash,
      expires_at: prepared.expiresAt,
      roles: {
        create: prepared.uniqueRoleIds.map((role_id) => ({ role_id })),
      },
      branches: {
        create: prepared.uniqueBranchIds.map((branch_id) => ({
          branch_id,
          organization_id: organizationId,
        })),
      },
      job_functions: prepared.jobFunctions.length
        ? {
            create: prepared.jobFunctions.map((jf) => ({
              job_function_id: jf.id,
            })),
          }
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
        executive_title: invitation.executive_title,
        engagement_type: invitation.engagement_type,
      },
      create: {
        user_id: user.id,
        organization_id: invitation.organization_id,
        executive_title: invitation.executive_title,
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
      tx.profileRole.createMany({
        data: invitation.roles.map((item) => ({
          profile_id: profileId,
          role_id: item.role_id,
        })),
        skipDuplicates: true,
      }),
      tx.profileBranch.createMany({
        data: invitation.branches.map((item) => ({
          profile_id: profileId,
          branch_id: item.branch_id,
          organization_id: invitation.organization_id,
        })),
        skipDuplicates: true,
      }),
      invitation.job_functions.length
        ? tx.profileJobFunction.createMany({
            data: invitation.job_functions.map((item) => ({
              profile_id: profileId,
              job_function_id: item.job_function_id,
            })),
            skipDuplicates: true,
          })
        : Promise.resolve(),
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
