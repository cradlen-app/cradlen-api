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
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { InvitationStatus, Prisma } from '@prisma/client';
import { ERROR_CODES } from '../../common/constant/error-codes.js';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import type { AppConfig } from '../../config/app.config.js';
import type { AuthConfig } from '../../config/auth.config.js';
import { PrismaService } from '../../database/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import type { BranchScheduleDto } from '../staff/dto/staff.dto.js';
import { persistSchedules } from '../staff/schedule.helpers.js';
import type {
  AcceptInvitationDto,
  CreateInvitationDto,
  DeclineInvitationDto,
  PreviewInvitationQueryDto,
} from './dto/invitation.dto.js';
import { InvitationAcceptedEvent } from '../notifications/events/invitation-accepted.event.js';
import { InvitationDeclinedEvent } from '../notifications/events/invitation-declined.event.js';

@Injectable()
export class InvitationsService {
  private readonly appConfig: AppConfig;
  private readonly authConfig: AuthConfig;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly mailService: MailService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly eventEmitter: EventEmitter2,
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
    await this.authorizationService.assertCanManageStaff(
      profileId,
      organizationId,
    );
    await this.subscriptionsService.assertStaffLimit(organizationId);

    const invitingUser = await this.prismaService.db.user.findUnique({
      where: { id: currentUserId },
      select: { email: true },
    });

    if (invitingUser?.email?.toLowerCase() === dto.email.toLowerCase()) {
      throw new BadRequestException('You cannot invite yourself');
    }

    const uniqueRoleIds = [...new Set(dto.role_ids)];
    const uniqueBranchIds = [...new Set(dto.branch_ids)];

    await this.assertBranchesInOrganization(organizationId, uniqueBranchIds);
    await this.assertRolesExist(uniqueRoleIds);

    const rawToken = randomUUID();
    const tokenHash = await bcrypt.hash(rawToken, 10);
    const expiresAt = new Date(
      Date.now() + this.authConfig.invitationExpireHours * 60 * 60 * 1000,
    );

    let invitation: Awaited<
      ReturnType<InvitationsService['findInvitationShape']>
    >;
    try {
      invitation = await this.prismaService.db.invitation.create({
        data: {
          organization_id: organizationId,
          invited_by_id: currentUserId,
          email: dto.email,
          first_name: dto.first_name,
          last_name: dto.last_name,
          phone_number: dto.phone_number,
          job_title: dto.job_title,
          specialty: dto.specialty,
          is_clinical: dto.is_clinical ?? false,
          token_hash: tokenHash,
          expires_at: expiresAt,
          roles: { create: uniqueRoleIds.map((role_id) => ({ role_id })) },
          branches: {
            create: uniqueBranchIds.map((branch_id) => ({
              branch_id,
              organization_id: organizationId,
            })),
          },
        },
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

    const inviteUrl = `${this.appConfig.appUrl}/invitations/accept?invitation=${invitation.id}&token=${rawToken}`;
    await this.mailService.sendStaffInvitationEmail(dto.email, inviteUrl);
    return this.toResponse(invitation);
  }

  async listInvitations(
    profileId: string,
    organizationId: string,
    branchId?: string,
  ) {
    await this.authorizationService.assertCanManageStaff(
      profileId,
      organizationId,
    );
    const where: Prisma.InvitationWhereInput = {
      organization_id: organizationId,
      is_deleted: false,
    };
    if (branchId) {
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
          job_title: invitation.job_title,
          specialty: invitation.specialty,
          is_clinical: invitation.is_clinical,
        },
        create: {
          user_id: user.id,
          organization_id: invitation.organization_id,
          job_title: invitation.job_title,
          specialty: invitation.specialty,
          is_clinical: invitation.is_clinical,
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
    this.eventEmitter.emit('invitation.accepted', event);

    return result;
  }

  async getInvitation(
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
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
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
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException(
        'Only pending invitations can be cancelled',
      );
    }
    const updated = await this.prismaService.db.invitation.update({
      where: { id: invitationId },
      data: {
        status: InvitationStatus.CANCELLED,
        is_deleted: true,
        deleted_at: new Date(),
      },
      include: this.includeInvitation(),
    });
    return this.toResponse(updated);
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
    ]);
  }

  private includeInvitation() {
    return {
      roles: { include: { role: true } },
      branches: { include: { branch: true } },
      invited_by: {
        select: { id: true, first_name: true, last_name: true, email: true },
      },
    } satisfies Prisma.InvitationInclude;
  }

  private includePreview() {
    return {
      roles: { include: { role: true } },
      branches: { include: { branch: true } },
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
    this.eventEmitter.emit('invitation.declined', event);

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
      is_clinical: invitation.is_clinical,
      job_title: invitation.job_title,
      specialty: invitation.specialty,
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
      job_title: invitation.job_title,
      specialty: invitation.specialty,
      is_clinical: invitation.is_clinical,
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
      ...(workingSchedule !== undefined && {
        working_schedule:
          workingSchedule?.map((ws) => ({
            branch: ws.branch,
            days: ws.days.map((d) => ({
              day_of_week: d.day_of_week,
              shifts: d.shifts.map((s) => ({
                start_time: s.start_time,
                end_time: s.end_time,
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
