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
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { InvitationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
import type { AppConfig } from '../../config/app.config.js';
import type { AuthConfig } from '../../config/auth.config.js';
import type { InviteStaffDto } from './dto/invite-staff.dto.js';
import type { AcceptInvitationDto } from './dto/accept-invitation.dto.js';
import type { UpdateStaffDto } from './dto/update-staff.dto.js';
import type { UpdateScheduleDto } from './dto/update-schedule.dto.js';
import type {
  ListStaffQueryDto,
  ListInvitationsQueryDto,
} from './dto/list-staff-query.dto.js';
import { paginated } from '../../common/utils/pagination.utils.js';
import type { AuthTokensDto } from '../auth/dto/auth-tokens.dto.js';
import type {
  JwtAccessPayload,
  JwtRefreshPayload,
} from '../auth/interfaces/jwt-payload.interface.js';

const STAFF_INVITATION_INCLUDE = {
  organization: { select: { id: true, name: true } },
  invited_by: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      email: true,
    },
  },
  role: { select: { id: true, name: true } },
  branches: {
    include: {
      branch: {
        select: {
          id: true,
          address: true,
          city: true,
          governorate: true,
          country: true,
          is_main: true,
        },
      },
      schedule: { include: { days: { include: { shifts: true } } } },
    },
  },
} satisfies Prisma.StaffInvitationInclude;

@Injectable()
export class StaffService {
  private readonly appConfig: AppConfig;
  private readonly authConfig: AuthConfig;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {
    const app = this.configService.get<AppConfig>('app');
    if (!app) throw new Error('App configuration not loaded');
    this.appConfig = app;

    const auth = this.configService.get<AuthConfig>('auth');
    if (!auth) throw new Error('Auth configuration not loaded');
    this.authConfig = auth;
  }

  async assertOwner(
    userId: string,
    organizationId: string,
    branchId?: string,
  ): Promise<void> {
    const staff = await this.prismaService.db.staff.findFirst({
      where: {
        user_id: userId,
        organization_id: organizationId,
        ...(branchId ? { branch_id: branchId } : {}),
        is_deleted: false,
        role: { name: 'owner' },
      },
    });
    if (!staff)
      throw new ForbiddenException(
        'Only organization owners can perform this action',
      );
  }

  private normalizeInvitationStatus(
    status: string,
  ): InvitationStatus | undefined {
    const normalized = status.trim().toUpperCase();
    if (normalized === 'CANCELED' || normalized === 'REVOKED') {
      return InvitationStatus.CANCELLED;
    }
    if (normalized in InvitationStatus) {
      return InvitationStatus[normalized as keyof typeof InvitationStatus];
    }
    return undefined;
  }

  private invitationStatusForResponse(invitation: {
    status: InvitationStatus;
    expires_at: Date;
  }) {
    if (
      invitation.status === InvitationStatus.PENDING &&
      invitation.expires_at < new Date()
    ) {
      return 'expired';
    }
    return invitation.status.toLowerCase();
  }

  private branchDisplayName(branch: {
    is_main: boolean;
    city: string;
    governorate: string;
  }) {
    if (branch.is_main) return 'Main branch';
    return branch.city || branch.governorate || 'Branch';
  }

  private parseDurationToSeconds(duration: string): number {
    const match = /^(\d+)([smhd])$/.exec(duration);
    if (!match) return 900;
    const value = parseInt(match[1], 10);
    const multipliers: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };
    return value * (multipliers[match[2]] ?? 1);
  }

  private validateScheduleOrder(
    days: { shifts: { start_time: string; end_time: string }[] }[],
  ): void {
    for (const day of days) {
      for (const shift of day.shifts) {
        if (shift.start_time >= shift.end_time) {
          throw new BadRequestException(
            'Shift start_time must be before end_time',
          );
        }
      }
    }
  }

  private async replaceStaffSchedule(
    tx: Prisma.TransactionClient,
    staffId: string,
    days: UpdateScheduleDto['days'],
  ): Promise<void> {
    await tx.workingSchedule
      .delete({ where: { staff_id: staffId } })
      .catch(() => undefined);

    await tx.workingSchedule.create({
      data: {
        staff_id: staffId,
        days: {
          create: days.map((d) => ({
            day_of_week: d.day_of_week,
            shifts: {
              create: d.shifts.map((s) => ({
                start_time: s.start_time,
                end_time: s.end_time,
              })),
            },
          })),
        },
      },
    });
  }

  private async issueTokenPair(
    tx: Prisma.TransactionClient,
    user: { id: string; email: string },
  ): Promise<AuthTokensDto> {
    const jti = randomUUID();
    const accessExpiresIn = this.parseDurationToSeconds(
      this.authConfig.jwt.accessExpiration,
    );
    const refreshExpiresIn = this.parseDurationToSeconds(
      this.authConfig.jwt.refreshExpiration,
    );
    const accessPayload: JwtAccessPayload = {
      sub: user.id,
      email: user.email,
      type: 'access',
    };
    const refreshPayload: JwtRefreshPayload = {
      sub: user.id,
      jti,
      type: 'refresh',
    };
    const accessToken = this.jwtService.sign(accessPayload, {
      secret: this.authConfig.jwt.accessSecret,
      expiresIn: accessExpiresIn,
    });
    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: this.authConfig.jwt.refreshSecret,
      expiresIn: refreshExpiresIn,
    });
    const refreshHash = await bcrypt.hash(refreshToken, 10);
    const refreshExpiry = new Date(Date.now() + refreshExpiresIn * 1000);

    await tx.refreshToken.create({
      data: {
        jti,
        token_hash: refreshHash,
        user_id: user.id,
        expires_at: refreshExpiry,
      },
    });

    return {
      type: 'tokens',
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: accessExpiresIn,
    };
  }

  private toInvitationResponse(
    invitation: Prisma.StaffInvitationGetPayload<{
      include: typeof STAFF_INVITATION_INCLUDE;
    }>,
    userExists = false,
  ) {
    const firstBranch = invitation.branches[0];
    const branchId = firstBranch?.branch_id ?? null;

    return {
      id: invitation.id,
      organization_id: invitation.organization_id,
      branch_id: branchId,
      email: invitation.email,
      first_name: invitation.first_name,
      last_name: invitation.last_name,
      phone: invitation.phone,
      role_id: invitation.role_id,
      role_name: invitation.role.name,
      role: invitation.role,
      job_title: invitation.job_title,
      specialty: invitation.specialty,
      status: this.invitationStatusForResponse(invitation),
      created_at: invitation.created_at,
      sent_at: invitation.updated_at,
      invited_at: invitation.created_at,
      expires_at: invitation.expires_at,
      accepted_at: invitation.accepted_at,
      organization: invitation.organization,
      organization_name: invitation.organization.name,
      invited_by: invitation.invited_by,
      branches: invitation.branches.map((invitationBranch) => {
        const branchName = this.branchDisplayName(invitationBranch.branch);
        return {
          id: invitationBranch.id,
          branch_id: invitationBranch.branch_id,
          branch_name: branchName,
          branch: {
            ...invitationBranch.branch,
            name: branchName,
          },
          schedule: invitationBranch.schedule,
        };
      }),
      user_exists: userExists,
    };
  }

  async sendInvitation(currentUserId: string, dto: InviteStaffDto) {
    await this.assertOwner(currentUserId, dto.organization_id);
    for (const branch of dto.branches) {
      this.validateScheduleOrder(branch.schedule.days);
    }

    const branches = await this.prismaService.db.branch.findMany({
      where: {
        id: { in: dto.branches.map((b) => b.branch_id) },
        organization_id: dto.organization_id,
        is_deleted: false,
      },
    });
    if (branches.length !== dto.branches.length) {
      throw new BadRequestException(
        'One or more branches do not belong to this organization',
      );
    }

    const existing = await this.prismaService.db.staffInvitation.findFirst({
      where: {
        email: dto.email,
        organization_id: dto.organization_id,
        status: 'PENDING',
        is_deleted: false,
      },
    });
    if (existing) {
      throw new ConflictException(
        'A pending invitation already exists for this email in this organization',
      );
    }

    const rawToken = randomUUID();
    const tokenHash = await bcrypt.hash(rawToken, 10);
    const expiresAt = new Date();
    expiresAt.setHours(
      expiresAt.getHours() + this.authConfig.invitationExpireHours,
    );

    const invitation = await this.prismaService.db.$transaction(async (tx) => {
      return tx.staffInvitation.create({
        data: {
          organization_id: dto.organization_id,
          invited_by_id: currentUserId,
          role_id: dto.role_id,
          email: dto.email,
          first_name: dto.first_name,
          last_name: dto.last_name,
          phone: dto.phone,
          job_title: dto.job_title,
          specialty: dto.specialty,
          token_hash: tokenHash,
          expires_at: expiresAt,
          branches: {
            create: dto.branches.map((b) => ({
              branch_id: b.branch_id,
              organization_id: dto.organization_id,
              schedule: {
                create: {
                  days: {
                    create: b.schedule.days.map((d) => ({
                      day_of_week: d.day_of_week,
                      shifts: {
                        create: d.shifts.map((s) => ({
                          start_time: s.start_time,
                          end_time: s.end_time,
                        })),
                      },
                    })),
                  },
                },
              },
            })),
          },
        },
      });
    });

    const inviteUrl = `${this.appConfig.appUrl}/staff/invite?token=${rawToken}&invite=${invitation.id}`;
    await this.mailService.sendStaffInvitationEmail(dto.email, inviteUrl);
    return invitation;
  }

  async previewInvitation(token: string, invitationId: string) {
    const invitation = await this.prismaService.db.staffInvitation.findFirst({
      where: { id: invitationId, is_deleted: false },
      include: STAFF_INVITATION_INCLUDE,
    });

    if (!invitation) throw new UnauthorizedException('Invalid invitation');

    const tokenMatch = await bcrypt.compare(token, invitation.token_hash);
    if (!tokenMatch)
      throw new UnauthorizedException('Invalid invitation token');

    if (invitation.status === 'CANCELLED')
      throw new UnauthorizedException('Invalid invitation');
    if (invitation.status === 'ACCEPTED')
      throw new ConflictException('Invitation already accepted');
    if (invitation.expires_at < new Date())
      throw new GoneException('Invitation has expired');

    const existingUser = await this.prismaService.db.user.findFirst({
      where: { email: invitation.email, is_deleted: false },
    });

    return { data: this.toInvitationResponse(invitation, !!existingUser) };
  }

  async acceptInvitation(dto: AcceptInvitationDto) {
    const invitation = await this.prismaService.db.staffInvitation.findFirst({
      where: { id: dto.invitation_id, is_deleted: false },
      include: {
        role: { select: { name: true } },
        branches: {
          include: {
            schedule: { include: { days: { include: { shifts: true } } } },
          },
        },
      },
    });

    if (!invitation) throw new UnauthorizedException('Invalid invitation');

    const tokenMatch = await bcrypt.compare(dto.token, invitation.token_hash);
    if (!tokenMatch)
      throw new UnauthorizedException('Invalid invitation token');

    if (invitation.status === 'CANCELLED')
      throw new UnauthorizedException('Invalid invitation');
    if (invitation.status === 'ACCEPTED')
      throw new ConflictException('Invitation already accepted');
    if (invitation.expires_at < new Date())
      throw new GoneException('Invitation has expired');

    const isDoctorRole = invitation.role?.name === 'doctor';

    const tokens = await this.prismaService.db.$transaction(async (tx) => {
      const claimed = await tx.staffInvitation.updateMany({
        where: {
          id: invitation.id,
          status: InvitationStatus.PENDING,
          accepted_at: null,
          is_deleted: false,
          expires_at: { gt: new Date() },
        },
        data: { status: InvitationStatus.ACCEPTED, accepted_at: new Date() },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Invitation has already been accepted');
      }

      let user = await tx.user.findFirst({
        where: { email: invitation.email, is_deleted: false },
      });

      if (!user) {
        const passwordHash = await bcrypt.hash(dto.password, 12);
        user = await tx.user.create({
          data: {
            first_name: invitation.first_name,
            last_name: invitation.last_name,
            email: invitation.email,
            phone_number: invitation.phone,
            password_hashed: passwordHash,
            registration_status: 'ACTIVE',
            verified_at: new Date(),
          },
        });
      } else {
        const passwordMatch = await bcrypt.compare(
          dto.password,
          user.password_hashed,
        );
        if (!passwordMatch)
          throw new UnauthorizedException('Invalid credentials');
      }

      for (const invBranch of invitation.branches) {
        let staffRecord;
        try {
          staffRecord = await tx.staff.create({
            data: {
              user_id: user.id,
              organization_id: invitation.organization_id,
              branch_id: invBranch.branch_id,
              role_id: invitation.role_id,
              job_title: invitation.job_title,
              specialty: invitation.specialty,
              is_clinical: isDoctorRole,
            },
          });
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            staffRecord = await tx.staff.findFirst({
              where: {
                user_id: user.id,
                organization_id: invitation.organization_id,
                branch_id: invBranch.branch_id,
                role_id: invitation.role_id,
              },
            });
            if (!staffRecord)
              throw new Error(
                'Staff record creation failed despite no conflict',
              );
            if (isDoctorRole && !staffRecord.is_clinical) {
              staffRecord = await tx.staff.update({
                where: { id: staffRecord.id },
                data: { is_clinical: true },
              });
            }
          } else {
            throw err;
          }
        }

        if (staffRecord && invBranch.schedule) {
          await tx.workingSchedule.create({
            data: {
              staff_id: staffRecord.id,
              days: {
                create: invBranch.schedule.days.map((d) => ({
                  day_of_week: d.day_of_week,
                  shifts: {
                    create: d.shifts.map((s) => ({
                      start_time: s.start_time,
                      end_time: s.end_time,
                    })),
                  },
                })),
              },
            },
          });
        }
      }

      return this.issueTokenPair(tx, user);
    });

    return tokens;
  }

  async listInvitations(currentUserId: string, query: ListInvitationsQueryDto) {
    await this.assertOwner(currentUserId, query.organization_id);

    const status = query.status
      ? this.normalizeInvitationStatus(query.status)
      : undefined;

    const where: Prisma.StaffInvitationWhereInput = {
      organization_id: query.organization_id,
      is_deleted: false,
      ...(query.branch_id
        ? { branches: { some: { branch_id: query.branch_id } } }
        : {}),
    };

    if (status === InvitationStatus.EXPIRED) {
      where.OR = [
        { status: InvitationStatus.EXPIRED },
        { status: InvitationStatus.PENDING, expires_at: { lt: new Date() } },
      ];
    } else if (status) {
      where.status = status;
    }

    const [total, items] = await Promise.all([
      this.prismaService.db.staffInvitation.count({ where }),
      this.prismaService.db.staffInvitation.findMany({
        where,
        include: STAFF_INVITATION_INCLUDE,
        orderBy: { created_at: 'desc' },
        skip: ((query.page ?? 1) - 1) * (query.limit ?? 20),
        take: query.limit ?? 20,
      }),
    ]);

    const existingUsers = await this.prismaService.db.user.findMany({
      where: {
        email: { in: items.map((item) => item.email) },
        is_deleted: false,
      },
      select: { email: true },
    });
    const existingEmails = new Set(existingUsers.map((user) => user.email));

    return paginated(
      items.map((item) =>
        this.toInvitationResponse(item, existingEmails.has(item.email)),
      ),
      {
        page: query.page ?? 1,
        limit: query.limit ?? 20,
        total,
      },
    );
  }

  async getInvitation(
    currentUserId: string,
    invitationId: string,
    organizationId: string,
    branchId: string,
  ) {
    const invitation = await this.prismaService.db.staffInvitation.findFirst({
      where: {
        id: invitationId,
        organization_id: organizationId,
        branches: { some: { branch_id: branchId } },
        is_deleted: false,
      },
      include: STAFF_INVITATION_INCLUDE,
    });
    if (!invitation) throw new NotFoundException('Invitation not found');

    await this.assertOwner(currentUserId, invitation.organization_id);

    const existingUser = await this.prismaService.db.user.findFirst({
      where: { email: invitation.email, is_deleted: false },
      select: { id: true },
    });

    return { data: this.toInvitationResponse(invitation, !!existingUser) };
  }

  async cancelInvitation(
    currentUserId: string,
    invitationId: string,
    organizationId: string,
    branchId: string,
  ) {
    const invitation = await this.prismaService.db.staffInvitation.findFirst({
      where: {
        id: invitationId,
        organization_id: organizationId,
        branches: { some: { branch_id: branchId } },
        is_deleted: false,
      },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');

    await this.assertOwner(currentUserId, invitation.organization_id);

    await this.prismaService.db.staffInvitation.update({
      where: { id: invitationId },
      data: {
        status: InvitationStatus.CANCELLED,
        is_deleted: true,
        deleted_at: new Date(),
      },
    });

    return { message: 'Invitation deleted successfully' };
  }

  async resendInvitation(
    currentUserId: string,
    invitationId: string,
    organizationId: string,
    branchId: string,
  ) {
    const invitation = await this.prismaService.db.staffInvitation.findFirst({
      where: {
        id: invitationId,
        organization_id: organizationId,
        branches: { some: { branch_id: branchId } },
        is_deleted: false,
      },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');

    await this.assertOwner(currentUserId, invitation.organization_id);

    if (invitation.status !== InvitationStatus.PENDING)
      throw new BadRequestException('Only pending invitations can be resent');

    const rawToken = randomUUID();
    const tokenHash = await bcrypt.hash(rawToken, 10);
    const expiresAt = new Date();
    expiresAt.setHours(
      expiresAt.getHours() + this.authConfig.invitationExpireHours,
    );

    const updated = await this.prismaService.db.staffInvitation.update({
      where: { id: invitationId },
      data: { token_hash: tokenHash, expires_at: expiresAt },
      select: {
        id: true,
        status: true,
        updated_at: true,
        expires_at: true,
      },
    });

    const inviteUrl = `${this.appConfig.appUrl}/staff/invite?token=${rawToken}&invite=${invitation.id}`;
    await this.mailService.sendStaffInvitationEmail(
      invitation.email,
      inviteUrl,
    );

    return {
      data: {
        id: updated.id,
        status: updated.status.toLowerCase(),
        sent_at: updated.updated_at,
        expires_at: updated.expires_at,
      },
      message: 'Invitation resent successfully',
    };
  }

  async listStaff(currentUserId: string, query: ListStaffQueryDto) {
    const requesterStaff = await this.prismaService.db.staff.findFirst({
      where: {
        user_id: currentUserId,
        organization_id: query.organization_id,
        branch_id: query.branch_id,
        is_deleted: false,
      },
    });
    if (!requesterStaff) throw new ForbiddenException('Access denied');

    const where: Prisma.StaffWhereInput = {
      organization_id: query.organization_id,
      branch_id: query.branch_id,
      is_deleted: false,
      NOT: {
        AND: [{ role: { name: 'owner' } }, { is_clinical: false }],
      },
    };

    const search = query.q?.trim();
    if (search) {
      where.OR = [
        { user: { first_name: { contains: search, mode: 'insensitive' } } },
        { user: { last_name: { contains: search, mode: 'insensitive' } } },
        { specialty: { contains: search, mode: 'insensitive' } },
        { job_title: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (query.role_id) {
      const role = await this.prismaService.db.role.findFirst({
        where: { id: query.role_id },
        select: { name: true },
      });

      if (!role) {
        return paginated([], {
          page: query.page ?? 1,
          limit: query.limit ?? 20,
          total: 0,
        });
      }

      if (role.name === 'doctor') {
        where.is_clinical = true;
      } else {
        where.role_id = query.role_id;
      }
    }

    const [total, items] = await Promise.all([
      this.prismaService.db.staff.count({ where }),
      this.prismaService.db.staff.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
              phone_number: true,
            },
          },
          role: { select: { id: true, name: true } },
          schedule: { include: { days: { include: { shifts: true } } } },
        },
        orderBy: { created_at: 'desc' },
        skip: ((query.page ?? 1) - 1) * (query.limit ?? 20),
        take: query.limit ?? 20,
      }),
    ]);

    return paginated(items, {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      total,
    });
  }

  async getStaff(
    currentUserId: string,
    staffId: string,
    organizationId: string,
    branchId: string,
  ) {
    await this.assertOwner(currentUserId, organizationId);

    const staff = await this.prismaService.db.staff.findFirst({
      where: {
        id: staffId,
        organization_id: organizationId,
        branch_id: branchId,
        is_deleted: false,
      },
      include: {
        user: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            phone_number: true,
          },
        },
        role: { select: { id: true, name: true } },
        schedule: { include: { days: { include: { shifts: true } } } },
      },
    });
    if (!staff) throw new NotFoundException('Staff member not found');
    return staff;
  }

  async updateStaff(
    currentUserId: string,
    staffId: string,
    organizationId: string,
    branchId: string,
    dto: UpdateStaffDto,
  ) {
    await this.assertOwner(currentUserId, organizationId);

    const staff = await this.prismaService.db.staff.findFirst({
      where: {
        id: staffId,
        organization_id: organizationId,
        branch_id: branchId,
        is_deleted: false,
      },
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    const branchSchedule = dto.branches?.find(
      (branch) => branch.branch_id === staff.branch_id,
    );
    if (dto.branches && !branchSchedule) {
      throw new BadRequestException(
        'branches must include the staff member branch_id',
      );
    }
    if (branchSchedule) {
      this.validateScheduleOrder(branchSchedule.schedule.days);
    }

    return this.prismaService.db.$transaction(async (tx) => {
      const phoneNumber = dto.phone_number ?? dto.phone;
      if (
        dto.first_name !== undefined ||
        dto.last_name !== undefined ||
        phoneNumber !== undefined
      ) {
        await tx.user.update({
          where: { id: staff.user_id },
          data: {
            ...(dto.first_name !== undefined
              ? { first_name: dto.first_name }
              : {}),
            ...(dto.last_name !== undefined
              ? { last_name: dto.last_name }
              : {}),
            ...(phoneNumber !== undefined ? { phone_number: phoneNumber } : {}),
          },
        });
      }

      if (branchSchedule) {
        await this.replaceStaffSchedule(
          tx,
          staffId,
          branchSchedule.schedule.days,
        );
      }

      return tx.staff.update({
        where: { id: staffId },
        data: {
          ...(dto.role_id !== undefined ? { role_id: dto.role_id } : {}),
          ...(dto.job_title !== undefined ? { job_title: dto.job_title } : {}),
          ...(dto.specialty !== undefined ? { specialty: dto.specialty } : {}),
        },
        include: {
          user: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
              phone_number: true,
            },
          },
          role: { select: { id: true, name: true } },
          schedule: { include: { days: { include: { shifts: true } } } },
        },
      });
    });
  }

  async deleteStaff(
    currentUserId: string,
    staffId: string,
    organizationId: string,
    branchId: string,
  ) {
    await this.assertOwner(currentUserId, organizationId);

    const staff = await this.prismaService.db.staff.findFirst({
      where: {
        id: staffId,
        organization_id: organizationId,
        branch_id: branchId,
        is_deleted: false,
      },
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    await this.prismaService.db.staff.update({
      where: { id: staffId },
      data: { is_deleted: true, deleted_at: new Date() },
    });
  }

  async getSchedule(
    currentUserId: string,
    staffId: string,
    organizationId: string,
    branchId: string,
  ) {
    const [isOwner, targetStaff] = await Promise.all([
      this.prismaService.db.staff.findFirst({
        where: {
          user_id: currentUserId,
          organization_id: organizationId,
          is_deleted: false,
          role: { name: 'owner' },
        },
      }),
      this.prismaService.db.staff.findFirst({
        where: {
          id: staffId,
          organization_id: organizationId,
          branch_id: branchId,
          is_deleted: false,
        },
      }),
    ]);
    if (!targetStaff) throw new NotFoundException('Staff member not found');
    if (!isOwner && targetStaff.user_id !== currentUserId)
      throw new ForbiddenException('Access denied');

    return this.prismaService.db.workingSchedule.findUnique({
      where: { staff_id: staffId },
      include: { days: { include: { shifts: true } } },
    });
  }

  async updateSchedule(
    currentUserId: string,
    staffId: string,
    organizationId: string,
    branchId: string,
    dto: UpdateScheduleDto,
  ) {
    this.validateScheduleOrder(dto.days);

    const [isOwner, targetStaff] = await Promise.all([
      this.prismaService.db.staff.findFirst({
        where: {
          user_id: currentUserId,
          organization_id: organizationId,
          is_deleted: false,
          role: { name: 'owner' },
        },
      }),
      this.prismaService.db.staff.findFirst({
        where: {
          id: staffId,
          organization_id: organizationId,
          branch_id: branchId,
          is_deleted: false,
        },
      }),
    ]);
    if (!targetStaff) throw new NotFoundException('Staff member not found');
    if (!isOwner && targetStaff.user_id !== currentUserId)
      throw new ForbiddenException('Access denied');

    await this.prismaService.db.$transaction((tx) =>
      this.replaceStaffSchedule(tx, staffId, dto.days),
    );
  }
}
