import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { InvitationStatus, Prisma } from '@prisma/client';
import { ERROR_CODES } from '@common/constant/error-codes.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AppConfig } from '@config/app.config.js';
import type { AuthConfig } from '@config/auth.config.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EmailService } from '@infrastructure/email/email.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import type { BranchScheduleDto } from '../staff/dto/staff.dto.js';
import { persistSchedules } from '../staff/schedule.helpers.js';
import { minutesToHhmm } from '../staff/shift-time.helpers.js';
import type {
  AcceptInvitationDto,
  BulkCreateInvitationsDto,
  CreateInvitationDto,
  DeclineInvitationDto,
  PreviewInvitationQueryDto,
} from './dto/invitation.dto.js';
import { InvitationAcceptedEvent } from '@core/notifications/events/invitation-accepted.event.js';
import { InvitationDeclinedEvent } from '@core/notifications/events/invitation-declined.event.js';

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
    configService: ConfigService,
  ) {
    const app = configService.get<AppConfig>('app');
    const auth = configService.get<AuthConfig>('auth');
    if (!app || !auth) throw new Error('Configuration not loaded');
    this.appConfig = app;
    this.authConfig = auth;
  }

  async createInvitation(
    currentUserId: string,
    profileId: string,
    organizationId: string,
    dto: CreateInvitationDto,
  ) {
    const uniqueBranchIds = [...new Set(dto.branch_ids)];
    const uniqueRoleIds = [...new Set(dto.role_ids)];

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

    const invitingUser = await this.prismaService.db.user.findUnique({
      where: { id: currentUserId },
      select: { email: true },
    });

    if (invitingUser?.email?.toLowerCase() === dto.email.toLowerCase()) {
      throw new BadRequestException('You cannot invite yourself');
    }

    const prepared = await this.prepareInvitationData(organizationId, dto);

    let invitation: Awaited<
      ReturnType<InvitationsService['findInvitationShape']>
    >;
    try {
      invitation = await this.prismaService.db.invitation.create({
        data: this.buildInvitationCreateData(
          organizationId,
          currentUserId,
          dto,
          prepared,
        ),
        include: this.includeInvitation(),
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

    const inviteUrl = `${this.appConfig.appUrl}/invitations/accept?invitation=${invitation.id}&token=${prepared.rawToken}`;
    await this.mailService.sendStaffInvitationEmail(dto.email, inviteUrl);
    return this.toResponse(invitation);
  }

  async bulkCreateInvitations(
    currentUserId: string,
    profileId: string,
    organizationId: string,
    dto: BulkCreateInvitationsDto,
  ) {
    // Per-row branch/role checks: every invitation in the batch must be
    // within the caller's scope. Done up-front so the whole batch fails
    // fast rather than partially before the transaction opens.
    for (const item of dto.invitations) {
      const branchIds = [...new Set(item.branch_ids)];
      const roleIds = [...new Set(item.role_ids)];
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

    const invitingUser = await this.prismaService.db.user.findUnique({
      where: { id: currentUserId },
      select: { email: true },
    });
    const inviterEmail = invitingUser?.email?.toLowerCase() ?? null;
    for (const item of dto.invitations) {
      if (inviterEmail && item.email.toLowerCase() === inviterEmail) {
        throw new BadRequestException('You cannot invite yourself');
      }
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
        const inviteUrl = `${this.appConfig.appUrl}/invitations/accept?invitation=${id}&token=${prepared[idx].rawToken}`;
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
      this.assertBranchesInOrganization(organizationId, uniqueBranchIds),
      this.assertRolesExist(uniqueRoleIds),
    ]);

    const [jobFunctions, specialties] = await Promise.all([
      jobFunctionCodes.length
        ? this.prismaService.db.jobFunction.findMany({
            where: { code: { in: jobFunctionCodes } },
          })
        : Promise.resolve([]),
      specialtyCodes.length
        ? this.prismaService.db.specialty.findMany({
            where: { code: { in: specialtyCodes }, is_deleted: false },
          })
        : Promise.resolve([]),
    ]);
    if (jobFunctions.length !== jobFunctionCodes.length) {
      const found = new Set(jobFunctions.map((jf) => jf.code));
      const missing = jobFunctionCodes.filter((c) => !found.has(c));
      throw new BadRequestException(
        `Unknown job_function_codes: ${missing.join(', ')}`,
      );
    }
    if (specialties.length !== specialtyCodes.length) {
      const found = new Set(specialties.map((s) => s.code));
      const missing = specialtyCodes.filter((c) => !found.has(c));
      throw new BadRequestException(
        `Unknown specialty_codes: ${missing.join(', ')}`,
      );
    }

    const rawToken = randomUUID();
    const tokenHash = await bcrypt.hash(rawToken, 10);
    const expiresAt = new Date(
      Date.now() + this.authConfig.invitationExpireHours * 60 * 60 * 1000,
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
    branchId?: string,
  ) {
    await this.authorizationService.assertCanViewStaff(
      profileId,
      organizationId,
    );
    const where: Prisma.InvitationWhereInput = {
      organization_id: organizationId,
      is_deleted: false,
    };

    const isOwner = await this.authorizationService.isOwner(
      profileId,
      organizationId,
    );
    if (!isOwner) {
      const callerBranches =
        await this.authorizationService.getEffectiveBranchIds(
          profileId,
          organizationId,
        );
      if (!callerBranches.length) return [];
      if (branchId && !callerBranches.includes(branchId)) {
        throw new ForbiddenException('Branch outside your management scope');
      }
      where.branches = {
        some: { branch_id: { in: branchId ? [branchId] : callerBranches } },
      };
    } else if (branchId) {
      where.branches = { some: { branch_id: branchId } };
    }
    const invitations = await this.prismaService.db.invitation.findMany({
      where,
      include: this.includeInvitation(),
      orderBy: { created_at: 'desc' },
    });
    return invitations.map((item) => this.toResponse(item));
  }

  async acceptInvitation(dto: AcceptInvitationDto) {
    const invitation = await this.prismaService.db.invitation.findFirst({
      where: { id: dto.invitation_id, is_deleted: false },
      include: this.includeInvitation(),
    });
    if (!invitation) throw new UnauthorizedException('Invalid invitation');

    const tokenMatches = await bcrypt.compare(dto.token, invitation.token_hash);
    if (!tokenMatches)
      throw new UnauthorizedException('Invalid invitation token');
    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new ConflictException('Invitation already accepted');
    }
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new UnauthorizedException('Invitation is not active');
    }
    if (invitation.expires_at < new Date())
      throw new GoneException('Invitation expired');

    if (dto.schedule?.length) {
      const invitationBranchIds = invitation.branches.map((b) => b.branch_id);
      const invalidIds = dto.schedule
        .map((s) => s.branch_id)
        .filter((id) => !invitationBranchIds.includes(id));
      if (invalidIds.length) {
        throw new BadRequestException(
          `Schedule branch_ids not assigned in this invitation: ${invalidIds.join(', ')}`,
        );
      }
      this.assertShiftTimes(dto.schedule);
    }

    const existingUser = await this.prismaService.db.user.findFirst({
      where: { email: invitation.email, is_deleted: false },
    });
    if (existingUser?.password_hashed) {
      const matches = await bcrypt.compare(
        dto.password,
        existingUser.password_hashed,
      );
      if (!matches) throw new UnauthorizedException('Invalid credentials');
    }
    const passwordHash = await bcrypt.hash(dto.password, 12);

    const result = await this.prismaService.db.$transaction(async (tx) => {
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

      const [sub, activeStaff, pendingInvitations] = await Promise.all([
        tx.subscription.findFirst({
          where: {
            organization_id: invitation.organization_id,
            is_deleted: false,
          },
          include: { subscription_plan: true },
          orderBy: { created_at: 'desc' },
        }),
        tx.profile.count({
          where: {
            organization_id: invitation.organization_id,
            is_deleted: false,
            is_active: true,
          },
        }),
        tx.invitation.count({
          where: {
            organization_id: invitation.organization_id,
            is_deleted: false,
            status: InvitationStatus.PENDING,
          },
        }),
      ]);
      if (!sub) throw new NotFoundException('No active subscription found');
      const staffTotal = activeStaff + pendingInvitations;
      if (staffTotal >= sub.subscription_plan.max_staff) {
        throw new ForbiddenException({
          code: ERROR_CODES.SUBSCRIPTION_LIMIT_REACHED,
          message: `Staff limit reached (${sub.subscription_plan.max_staff}). Upgrade your plan.`,
          details: {
            resource: 'staff',
            limit: sub.subscription_plan.max_staff,
            current: staffTotal,
          },
        });
      }

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
    });

    const event = Object.assign(new InvitationAcceptedEvent(), {
      invitationId: invitation.id,
      inviterId: invitation.invited_by_id,
      inviteeName: `${invitation.first_name} ${invitation.last_name}`,
      organizationId: invitation.organization_id,
      branchId: invitation.branches[0]?.branch_id ?? null,
    });
    this.eventBus.publish('invitation.accepted', event);

    return result;
  }

  async getInvitation(
    profileId: string,
    organizationId: string,
    invitationId: string,
  ) {
    await this.authorizationService.assertCanViewStaff(
      profileId,
      organizationId,
    );
    const invitation = await this.prismaService.db.invitation.findFirst({
      where: {
        id: invitationId,
        organization_id: organizationId,
        is_deleted: false,
      },
      include: this.includeInvitation(),
    });
    if (!invitation) throw new NotFoundException('Invitation not found');

    await this.assertInvitationInScope(profileId, organizationId, invitation);

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

    return this.toResponse(invitation, workingSchedule);
  }

  async resendInvitation(
    profileId: string,
    organizationId: string,
    invitationId: string,
  ) {
    await this.authorizationService.assertCanManageStaff(
      profileId,
      organizationId,
    );
    const invitation = await this.prismaService.db.invitation.findFirst({
      where: {
        id: invitationId,
        organization_id: organizationId,
        is_deleted: false,
      },
      include: { branches: { select: { branch_id: true } } },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    await this.assertInvitationInScope(profileId, organizationId, invitation);
    if (invitation.status !== InvitationStatus.PENDING)
      throw new BadRequestException('Only pending invitations can be resent');

    const rawToken = randomUUID();
    const tokenHash = await bcrypt.hash(rawToken, 10);
    const expiresAt = new Date(
      Date.now() + this.authConfig.invitationExpireHours * 60 * 60 * 1000,
    );

    await this.prismaService.db.invitation.update({
      where: { id: invitationId },
      data: { token_hash: tokenHash, expires_at: expiresAt },
    });

    const inviteUrl = `${this.appConfig.appUrl}/invitations/accept?invitation=${invitation.id}&token=${rawToken}`;
    await this.mailService.sendStaffInvitationEmail(
      invitation.email,
      inviteUrl,
    );
  }

  async cancelInvitation(
    profileId: string,
    organizationId: string,
    invitationId: string,
  ) {
    await this.authorizationService.assertCanManageStaff(
      profileId,
      organizationId,
    );
    const invitation = await this.prismaService.db.invitation.findFirst({
      where: {
        id: invitationId,
        organization_id: organizationId,
        is_deleted: false,
      },
      include: this.includeInvitation(),
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    await this.assertInvitationInScope(profileId, organizationId, invitation);
    const updated = await this.prismaService.db.invitation.update({
      where: { id: invitationId },
      data: {
        is_deleted: true,
        deleted_at: new Date(),
        ...(invitation.status === InvitationStatus.PENDING && {
          status: InvitationStatus.CANCELLED,
        }),
      },
      include: this.includeInvitation(),
    });
    return this.toResponse(updated);
  }

  private async assertInvitationInScope(
    profileId: string,
    organizationId: string,
    invitation: { branches: { branch_id: string }[] },
  ): Promise<void> {
    if (await this.authorizationService.isOwner(profileId, organizationId)) {
      return;
    }
    const branchIds = invitation.branches.map((b) => b.branch_id);
    await this.authorizationService.assertCanManageStaffOnBranches(
      profileId,
      organizationId,
      branchIds,
    );
  }

  private assertShiftTimes(schedule: BranchScheduleDto[]) {
    for (const branch of schedule) {
      for (const day of branch.days) {
        for (const shift of day.shifts) {
          if (shift.end_time <= shift.start_time) {
            throw new BadRequestException(
              `Shift end_time must be after start_time (${shift.start_time} – ${shift.end_time})`,
            );
          }
        }
      }
    }
  }

  private async assertBranchesInOrganization(
    organizationId: string,
    branchIds: string[],
  ) {
    const count = await this.prismaService.db.branch.count({
      where: {
        id: { in: branchIds },
        organization_id: organizationId,
        is_deleted: false,
      },
    });
    if (count !== branchIds.length) {
      throw new NotFoundException('One or more branches were not found');
    }
  }

  private async assertRolesExist(roleIds: string[]) {
    const count = await this.prismaService.db.role.count({
      where: { id: { in: roleIds } },
    });
    if (count !== roleIds.length) {
      throw new NotFoundException('One or more roles were not found');
    }
  }

  private async assignProfileAccess(
    tx: Prisma.TransactionClient,
    profileId: string,
    invitation: Awaited<ReturnType<InvitationsService['findInvitationShape']>>,
  ) {
    await Promise.all([
      ...invitation.roles.map((item) =>
        tx.profileRole.upsert({
          where: {
            profile_id_role_id: {
              profile_id: profileId,
              role_id: item.role_id,
            },
          },
          update: {},
          create: { profile_id: profileId, role_id: item.role_id },
        }),
      ),
      ...invitation.branches.map((item) =>
        tx.profileBranch.upsert({
          where: {
            profile_id_branch_id: {
              profile_id: profileId,
              branch_id: item.branch_id,
            },
          },
          update: {},
          create: {
            profile_id: profileId,
            branch_id: item.branch_id,
            organization_id: invitation.organization_id,
          },
        }),
      ),
      ...invitation.job_functions.map((item) =>
        tx.profileJobFunction.upsert({
          where: {
            profile_id_job_function_id: {
              profile_id: profileId,
              job_function_id: item.job_function_id,
            },
          },
          update: {},
          create: {
            profile_id: profileId,
            job_function_id: item.job_function_id,
          },
        }),
      ),
      ...invitation.specialty_links.map((item) =>
        tx.profileSpecialty.upsert({
          where: {
            profile_id_specialty_id: {
              profile_id: profileId,
              specialty_id: item.specialty_id,
            },
          },
          update: {},
          create: {
            profile_id: profileId,
            specialty_id: item.specialty_id,
          },
        }),
      ),
    ]);
  }

  private includeInvitation() {
    return {
      roles: { include: { role: true } },
      branches: { include: { branch: true } },
      job_functions: { include: { job_function: true } },
      specialty_links: { include: { specialty: true } },
      invited_by: {
        select: { id: true, first_name: true, last_name: true, email: true },
      },
    } satisfies Prisma.InvitationInclude;
  }

  private includePreview() {
    return {
      roles: { include: { role: true } },
      branches: { include: { branch: true } },
      job_functions: { include: { job_function: true } },
      specialty_links: { include: { specialty: true } },
      invited_by: {
        select: { first_name: true, last_name: true },
      },
      organization: {
        select: { id: true, name: true },
      },
    } satisfies Prisma.InvitationInclude;
  }

  async declineInvitation(dto: DeclineInvitationDto) {
    const invitation = await this.prismaService.db.invitation.findFirst({
      where: { id: dto.invitation, is_deleted: false },
      select: {
        id: true,
        status: true,
        token_hash: true,
        invited_by_id: true,
        first_name: true,
        last_name: true,
        organization_id: true,
        branches: { select: { branch_id: true } },
      },
    });

    if (!invitation) throw new UnauthorizedException('Invalid invitation');

    const tokenMatches = await bcrypt.compare(dto.token, invitation.token_hash);
    if (!tokenMatches)
      throw new UnauthorizedException('Invalid invitation token');

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new ConflictException('Invitation is not pending');
    }

    await this.prismaService.db.invitation.update({
      where: { id: invitation.id },
      data: { status: InvitationStatus.CANCELLED },
    });

    const event = Object.assign(new InvitationDeclinedEvent(), {
      invitationId: invitation.id,
      inviterId: invitation.invited_by_id,
      inviteeName: `${invitation.first_name} ${invitation.last_name}`,
      organizationId: invitation.organization_id,
      branchId: invitation.branches[0]?.branch_id ?? null,
    });
    this.eventBus.publish('invitation.declined', event);

    return { message: 'Invitation declined' };
  }

  async previewInvitation(dto: PreviewInvitationQueryDto) {
    const invitation = await this.prismaService.db.invitation.findFirst({
      where: { id: dto.invitation, is_deleted: false },
      include: this.includePreview(),
    });

    if (!invitation) throw new UnauthorizedException('Invalid invitation');

    const tokenMatches = await bcrypt.compare(dto.token, invitation.token_hash);
    if (!tokenMatches)
      throw new UnauthorizedException('Invalid invitation token');

    if (invitation.status === InvitationStatus.ACCEPTED)
      throw new ConflictException('Invitation already accepted');

    if (invitation.status !== InvitationStatus.PENDING)
      throw new UnauthorizedException('Invitation is not active');

    if (invitation.expires_at < new Date())
      throw new GoneException('Invitation expired');

    return {
      id: invitation.id,
      status: invitation.status,
      expires_at: invitation.expires_at,
      email: invitation.email,
      first_name: invitation.first_name,
      last_name: invitation.last_name,
      executive_title: invitation.executive_title,
      engagement_type: invitation.engagement_type,
      organization: {
        id: invitation.organization.id,
        name: invitation.organization.name,
      },
      invited_by: {
        first_name: invitation.invited_by.first_name,
        last_name: invitation.invited_by.last_name,
      },
      roles: invitation.roles.map((r) => ({
        id: r.role.id,
        name: r.role.name,
      })),
      branches: invitation.branches.map((b) => ({
        id: b.branch.id,
        name: b.branch.name,
        city: b.branch.city,
        governorate: b.branch.governorate,
      })),
      job_functions: invitation.job_functions.map((j) => ({
        id: j.job_function.id,
        code: j.job_function.code,
        name: j.job_function.name,
      })),
      specialties: invitation.specialty_links.map((s) => ({
        id: s.specialty.id,
        code: s.specialty.code,
        name: s.specialty.name,
      })),
    };
  }

  private findInvitationShape() {
    return this.prismaService.db.invitation.findFirstOrThrow({
      include: this.includeInvitation(),
    });
  }

  private toResponse(
    invitation: Prisma.InvitationGetPayload<{
      include: ReturnType<InvitationsService['includeInvitation']>;
    }>,
    workingSchedule?: Awaited<
      ReturnType<InvitationsService['fetchWorkingSchedule']>
    > | null,
  ) {
    return {
      id: invitation.id,
      organization_id: invitation.organization_id,
      email: invitation.email,
      first_name: invitation.first_name,
      last_name: invitation.last_name,
      phone_number: invitation.phone_number,
      executive_title: invitation.executive_title,
      engagement_type: invitation.engagement_type,
      status: invitation.status,
      invited_at: invitation.created_at,
      expires_at: invitation.expires_at,
      accepted_at: invitation.accepted_at,
      invited_by: {
        id: invitation.invited_by.id,
        first_name: invitation.invited_by.first_name,
        last_name: invitation.invited_by.last_name,
        email: invitation.invited_by.email,
      },
      roles: invitation.roles.map((item) => ({
        id: item.role.id,
        name: item.role.name,
      })),
      branches: invitation.branches.map((item) => ({
        id: item.branch.id,
        name: item.branch.name,
        city: item.branch.city,
        governorate: item.branch.governorate,
      })),
      job_functions: invitation.job_functions.map((item) => ({
        id: item.job_function.id,
        code: item.job_function.code,
        name: item.job_function.name,
      })),
      specialties: invitation.specialty_links.map((item) => ({
        id: item.specialty.id,
        code: item.specialty.code,
        name: item.specialty.name,
      })),
      ...(workingSchedule !== undefined && {
        working_schedule:
          workingSchedule?.map((ws) => ({
            branch: ws.branch,
            days: ws.days.map((d) => ({
              day_of_week: d.day_of_week,
              shifts: d.shifts.map((s) => ({
                start_time: minutesToHhmm(s.start_minute),
                end_time: minutesToHhmm(s.end_minute),
              })),
            })),
          })) ?? null,
      }),
    };
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
