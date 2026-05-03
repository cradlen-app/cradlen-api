import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { InvitationStatus, Prisma } from '@prisma/client';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import type { AppConfig } from '../../config/app.config.js';
import type { AuthConfig } from '../../config/auth.config.js';
import { PrismaService } from '../../database/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
import type {
  AcceptInvitationDto,
  CreateInvitationDto,
} from './dto/invitation.dto.js';

@Injectable()
export class InvitationsService {
  private readonly appConfig: AppConfig;
  private readonly authConfig: AuthConfig;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly mailService: MailService,
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
    accountId: string,
    dto: CreateInvitationDto,
  ) {
    await this.authorizationService.assertCanManageStaff(profileId, accountId);
    await this.assertBranchesInAccount(accountId, dto.branch_ids);

    const existing = await this.prismaService.db.invitation.findFirst({
      where: {
        account_id: accountId,
        email: dto.email,
        status: InvitationStatus.PENDING,
        is_deleted: false,
      },
    });
    if (existing)
      throw new ConflictException('Pending invitation already exists');

    const rawToken = randomUUID();
    const tokenHash = await bcrypt.hash(rawToken, 10);
    const expiresAt = new Date(
      Date.now() + this.authConfig.invitationExpireHours * 60 * 60 * 1000,
    );

    const invitation = await this.prismaService.db.invitation.create({
      data: {
        account_id: accountId,
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
        roles: { create: dto.role_ids.map((role_id) => ({ role_id })) },
        branches: {
          create: dto.branch_ids.map((branch_id) => ({
            branch_id,
            account_id: accountId,
          })),
        },
      },
      include: this.includeInvitation(),
    });

    const inviteUrl = `${this.appConfig.appUrl}/invitations/accept?invitation=${invitation.id}&token=${rawToken}`;
    await this.mailService.sendStaffInvitationEmail(dto.email, inviteUrl);
    return this.toResponse(invitation);
  }

  async listInvitations(profileId: string, accountId: string) {
    await this.authorizationService.assertCanManageStaff(profileId, accountId);
    const invitations = await this.prismaService.db.invitation.findMany({
      where: { account_id: accountId, is_deleted: false },
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
    }

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
            password_hashed: await bcrypt.hash(dto.password, 12),
            registration_status: 'ACTIVE',
            onboarding_completed: true,
            verified_at: new Date(),
          },
        });
      } else if (user.password_hashed) {
        const matches = await bcrypt.compare(
          dto.password,
          user.password_hashed,
        );
        if (!matches) throw new UnauthorizedException('Invalid credentials');
      }

      const profile = await tx.profile.upsert({
        where: {
          user_id_account_id: {
            user_id: user.id,
            account_id: invitation.account_id,
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
          account_id: invitation.account_id,
          job_title: invitation.job_title,
          specialty: invitation.specialty,
          is_clinical: invitation.is_clinical,
        },
      });

      await this.assignProfileAccess(tx, profile.id, invitation);

      if (dto.schedule?.length) {
        for (const branchSchedule of dto.schedule) {
          const ws = await tx.workingSchedule.upsert({
            where: {
              profile_id_branch_id: {
                profile_id: profile.id,
                branch_id: branchSchedule.branch_id,
              },
            },
            update: {},
            create: { profile_id: profile.id, branch_id: branchSchedule.branch_id },
          });

          for (const day of branchSchedule.days) {
            const wd = await tx.workingDay.upsert({
              where: {
                schedule_id_day_of_week: {
                  schedule_id: ws.id,
                  day_of_week: day.day_of_week,
                },
              },
              update: {},
              create: { schedule_id: ws.id, day_of_week: day.day_of_week },
            });

            await tx.workingShift.createMany({
              data: day.shifts.map((s) => ({
                day_id: wd.id,
                start_time: s.start_time,
                end_time: s.end_time,
              })),
              skipDuplicates: true,
            });
          }
        }
      }

      return {
        user_id: user.id,
        profile_id: profile.id,
        account_id: invitation.account_id,
      };
    });

    return result;
  }

  async cancelInvitation(
    profileId: string,
    accountId: string,
    invitationId: string,
  ) {
    await this.authorizationService.assertCanManageStaff(profileId, accountId);
    const invitation = await this.prismaService.db.invitation.findFirst({
      where: { id: invitationId, account_id: accountId, is_deleted: false },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    return this.prismaService.db.invitation.update({
      where: { id: invitationId },
      data: {
        status: InvitationStatus.CANCELLED,
        is_deleted: true,
        deleted_at: new Date(),
      },
    });
  }

  private async assertBranchesInAccount(
    accountId: string,
    branchIds: string[],
  ) {
    const count = await this.prismaService.db.branch.count({
      where: {
        id: { in: branchIds },
        account_id: accountId,
        is_deleted: false,
      },
    });
    if (count !== new Set(branchIds).size) {
      throw new NotFoundException('One or more branches were not found');
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
            account_id: invitation.account_id,
          },
        }),
      ),
    ]);
  }

  private includeInvitation() {
    return {
      roles: { include: { role: true } },
      branches: { include: { branch: true } },
    } satisfies Prisma.InvitationInclude;
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
  ) {
    return {
      id: invitation.id,
      account_id: invitation.account_id,
      email: invitation.email,
      first_name: invitation.first_name,
      last_name: invitation.last_name,
      status: invitation.status,
      expires_at: invitation.expires_at,
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
    };
  }
}
