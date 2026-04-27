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
import { Prisma } from '@prisma/client';
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

  async assertOwner(userId: string, organizationId: string): Promise<void> {
    const staff = await this.prismaService.db.staff.findFirst({
      where: {
        user_id: userId,
        organization_id: organizationId,
        is_deleted: false,
        role: { name: 'owner' },
      },
    });
    if (!staff)
      throw new ForbiddenException(
        'Only organization owners can perform this action',
      );
  }

  async sendInvitation(currentUserId: string, dto: InviteStaffDto) {
    await this.assertOwner(currentUserId, dto.organization_id);

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
      include: {
        branches: {
          include: {
            schedule: { include: { days: { include: { shifts: true } } } },
          },
        },
      },
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

    return { ...invitation, user_exists: !!existingUser };
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

    const { accessToken, refreshToken } =
      await this.prismaService.db.$transaction(async (tx) => {
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

        await tx.staffInvitation.update({
          where: { id: invitation.id },
          data: { status: 'ACCEPTED', accepted_at: new Date() },
        });

        const jti = randomUUID();

        // Parse duration like '7d' or '30m' into seconds (JWT expiresIn expects seconds)
        const parseDurationSeconds = (duration: string): number => {
          const match = /^(\d+)([smhd])$/.exec(duration);
          if (!match) return 7 * 24 * 60 * 60;
          const value = parseInt(match[1], 10);
          const unit = match[2];
          const multipliers: Record<string, number> = {
            s: 1,
            m: 60,
            h: 3600,
            d: 86400,
          };
          return value * (multipliers[unit] ?? 1);
        };

        const accessToken = this.jwtService.sign(
          { sub: user.id, email: user.email },
          {
            secret: this.authConfig.jwt.accessSecret,
            expiresIn: parseDurationSeconds(
              this.authConfig.jwt.accessExpiration,
            ),
          },
        );
        const rawRefresh = randomUUID();
        const refreshHash = await bcrypt.hash(rawRefresh, 10);

        const refreshExpirySeconds = parseDurationSeconds(
          this.authConfig.jwt.refreshExpiration,
        );
        const refreshExpiry = new Date(
          Date.now() + refreshExpirySeconds * 1000,
        );

        await tx.refreshToken.create({
          data: {
            jti,
            token_hash: refreshHash,
            user_id: user.id,
            expires_at: refreshExpiry,
          },
        });

        const refreshToken = this.jwtService.sign(
          { sub: user.id, jti },
          {
            secret: this.authConfig.jwt.refreshSecret,
            expiresIn: refreshExpirySeconds,
          },
        );

        return { accessToken, refreshToken };
      });

    return { access_token: accessToken, refresh_token: refreshToken };
  }

  async listInvitations(currentUserId: string, query: ListInvitationsQueryDto) {
    await this.assertOwner(currentUserId, query.organization_id);

    const where = {
      organization_id: query.organization_id,
      is_deleted: false,
      ...(query.status ? { status: query.status } : {}),
    };

    const [total, items] = await Promise.all([
      this.prismaService.db.staffInvitation.count({ where }),
      this.prismaService.db.staffInvitation.findMany({
        where,
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

  async cancelInvitation(
    currentUserId: string,
    invitationId: string,
    organizationId: string,
  ) {
    await this.assertOwner(currentUserId, organizationId);

    const invitation = await this.prismaService.db.staffInvitation.findFirst({
      where: {
        id: invitationId,
        organization_id: organizationId,
        is_deleted: false,
      },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.status !== 'PENDING')
      throw new BadRequestException(
        'Only pending invitations can be cancelled',
      );

    await this.prismaService.db.staffInvitation.update({
      where: { id: invitationId },
      data: { status: 'CANCELLED' },
    });
  }

  async resendInvitation(
    currentUserId: string,
    invitationId: string,
    organizationId: string,
  ) {
    await this.assertOwner(currentUserId, organizationId);

    const invitation = await this.prismaService.db.staffInvitation.findFirst({
      where: {
        id: invitationId,
        organization_id: organizationId,
        is_deleted: false,
      },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.status !== 'PENDING')
      throw new BadRequestException('Only pending invitations can be resent');

    const rawToken = randomUUID();
    const tokenHash = await bcrypt.hash(rawToken, 10);
    const expiresAt = new Date();
    expiresAt.setHours(
      expiresAt.getHours() + this.authConfig.invitationExpireHours,
    );

    await this.prismaService.db.staffInvitation.update({
      where: { id: invitationId },
      data: { token_hash: tokenHash, expires_at: expiresAt },
    });

    const inviteUrl = `${this.appConfig.appUrl}/staff/invite?token=${rawToken}&invite=${invitation.id}`;
    await this.mailService.sendStaffInvitationEmail(
      invitation.email,
      inviteUrl,
    );
  }

  async listStaff(currentUserId: string, query: ListStaffQueryDto) {
    await this.assertOwner(currentUserId, query.organization_id);

    const where: Prisma.StaffWhereInput = {
      organization_id: query.organization_id,
      is_deleted: false,
      NOT: {
        AND: [{ role: { name: 'owner' } }, { is_clinical: false }],
      },
    };

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
  ) {
    await this.assertOwner(currentUserId, organizationId);

    const staff = await this.prismaService.db.staff.findFirst({
      where: {
        id: staffId,
        organization_id: organizationId,
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
    dto: UpdateStaffDto,
  ) {
    await this.assertOwner(currentUserId, organizationId);

    const staff = await this.prismaService.db.staff.findFirst({
      where: {
        id: staffId,
        organization_id: organizationId,
        is_deleted: false,
      },
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    return this.prismaService.db.staff.update({
      where: { id: staffId },
      data: {
        ...(dto.role_id ? { role_id: dto.role_id } : {}),
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
      },
    });
  }

  async deleteStaff(
    currentUserId: string,
    staffId: string,
    organizationId: string,
  ) {
    await this.assertOwner(currentUserId, organizationId);

    const staff = await this.prismaService.db.staff.findFirst({
      where: {
        id: staffId,
        organization_id: organizationId,
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
    dto: UpdateScheduleDto,
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
          is_deleted: false,
        },
      }),
    ]);
    if (!targetStaff) throw new NotFoundException('Staff member not found');
    if (!isOwner && targetStaff.user_id !== currentUserId)
      throw new ForbiddenException('Access denied');

    await this.prismaService.db.$transaction(async (tx) => {
      await tx.workingSchedule
        .delete({ where: { staff_id: staffId } })
        .catch(() => undefined);

      await tx.workingSchedule.create({
        data: {
          staff_id: staffId,
          days: {
            create: dto.days.map((d) => ({
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
    });
  }
}
