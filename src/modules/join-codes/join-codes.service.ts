import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { JoinCodeStatus, Prisma } from '@prisma/client';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  AcceptJoinCodeDto,
  CreateJoinCodeDto,
} from './dto/join-code.dto.js';

@Injectable()
export class JoinCodesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async createJoinCode(
    currentUserId: string,
    profileId: string,
    accountId: string,
    dto: CreateJoinCodeDto,
  ) {
    await this.authorizationService.assertCanManageStaff(profileId, accountId);
    await this.assertBranchesInAccount(accountId, dto.branch_ids);

    const code = this.generateCode();
    const code_lookup = this.lookup(code);
    const code_hash = await bcrypt.hash(code, 10);
    const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const joinCode = await this.prismaService.db.joinCode.create({
      data: {
        account_id: accountId,
        created_by_id: currentUserId,
        code_lookup,
        code_hash,
        first_name: dto.first_name,
        last_name: dto.last_name,
        job_title: dto.job_title,
        specialty: dto.specialty,
        is_clinical: dto.is_clinical ?? false,
        max_uses: dto.max_uses ?? 1,
        expires_at,
        roles: { create: dto.role_ids.map((role_id) => ({ role_id })) },
        branches: {
          create: dto.branch_ids.map((branch_id) => ({
            branch_id,
            account_id: accountId,
          })),
        },
      },
      include: this.includeJoinCode(),
    });

    return { ...this.toResponse(joinCode), code };
  }

  async listJoinCodes(profileId: string, accountId: string) {
    await this.authorizationService.assertCanManageStaff(profileId, accountId);
    const codes = await this.prismaService.db.joinCode.findMany({
      where: { account_id: accountId },
      include: this.includeJoinCode(),
      orderBy: { created_at: 'desc' },
    });
    return codes.map((item) => this.toResponse(item));
  }

  async acceptJoinCode(dto: AcceptJoinCodeDto) {
    if (!dto.email && !dto.phone_number) {
      throw new BadRequestException(
        'phone_number is required when email is absent',
      );
    }

    const joinCode = await this.prismaService.db.joinCode.findUnique({
      where: { code_lookup: this.lookup(dto.code) },
      include: this.includeJoinCode(),
    });
    if (!joinCode) throw new UnauthorizedException('Invalid join code');
    const matches = await bcrypt.compare(dto.code, joinCode.code_hash);
    if (!matches) throw new UnauthorizedException('Invalid join code');
    if (joinCode.status !== JoinCodeStatus.ACTIVE) {
      throw new UnauthorizedException('Join code is not active');
    }
    if (joinCode.expires_at < new Date())
      throw new GoneException('Join code expired');
    if (joinCode.used_count >= joinCode.max_uses) {
      throw new ConflictException('Join code has already been used');
    }

    return this.prismaService.db.$transaction(async (tx) => {
      const claimed = await tx.joinCode.updateMany({
        where: {
          id: joinCode.id,
          status: JoinCodeStatus.ACTIVE,
          used_count: { lt: joinCode.max_uses },
          expires_at: { gt: new Date() },
        },
        data: {
          used_count: { increment: 1 },
          ...(joinCode.used_count + 1 >= joinCode.max_uses
            ? { status: JoinCodeStatus.USED }
            : {}),
        },
      });
      if (claimed.count !== 1)
        throw new ConflictException('Join code already consumed');

      let user = await tx.user.findFirst({
        where: {
          OR: [
            ...(dto.email ? [{ email: dto.email }] : []),
            ...(dto.phone_number ? [{ phone_number: dto.phone_number }] : []),
          ],
          is_deleted: false,
        },
      });
      if (!user) {
        user = await tx.user.create({
          data: {
            first_name: joinCode.first_name ?? dto.first_name,
            last_name: joinCode.last_name ?? dto.last_name,
            email: dto.email,
            phone_number: dto.phone_number,
            password_hashed: await bcrypt.hash(dto.password, 12),
            registration_status: 'ACTIVE',
            onboarding_completed: true,
            verified_at: dto.email ? new Date() : undefined,
          },
        });
      }

      const profile = await tx.profile.upsert({
        where: {
          user_id_account_id: {
            user_id: user.id,
            account_id: joinCode.account_id,
          },
        },
        update: {
          is_active: true,
          is_deleted: false,
          deleted_at: null,
          job_title: joinCode.job_title,
          specialty: joinCode.specialty,
          is_clinical: joinCode.is_clinical,
        },
        create: {
          user_id: user.id,
          account_id: joinCode.account_id,
          job_title: joinCode.job_title,
          specialty: joinCode.specialty,
          is_clinical: joinCode.is_clinical,
        },
      });

      await Promise.all([
        ...joinCode.roles.map((item) =>
          tx.profileRole.upsert({
            where: {
              profile_id_role_id: {
                profile_id: profile.id,
                role_id: item.role_id,
              },
            },
            update: {},
            create: { profile_id: profile.id, role_id: item.role_id },
          }),
        ),
        ...joinCode.branches.map((item) =>
          tx.profileBranch.upsert({
            where: {
              profile_id_branch_id: {
                profile_id: profile.id,
                branch_id: item.branch_id,
              },
            },
            update: {},
            create: {
              profile_id: profile.id,
              branch_id: item.branch_id,
              account_id: joinCode.account_id,
            },
          }),
        ),
      ]);

      return {
        user_id: user.id,
        profile_id: profile.id,
        account_id: joinCode.account_id,
      };
    });
  }

  async revokeJoinCode(
    profileId: string,
    accountId: string,
    joinCodeId: string,
  ) {
    await this.authorizationService.assertCanManageStaff(profileId, accountId);
    const joinCode = await this.prismaService.db.joinCode.findFirst({
      where: { id: joinCodeId, account_id: accountId },
    });
    if (!joinCode) throw new NotFoundException('Join code not found');
    return this.prismaService.db.joinCode.update({
      where: { id: joinCodeId },
      data: { status: JoinCodeStatus.REVOKED, revoked_at: new Date() },
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

  private generateCode() {
    return `CRADLEN-${randomBytes(6).toString('hex').toUpperCase()}`;
  }

  private lookup(code: string) {
    return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
  }

  private includeJoinCode() {
    return {
      roles: { include: { role: true } },
      branches: { include: { branch: true } },
    } satisfies Prisma.JoinCodeInclude;
  }

  private toResponse(
    joinCode: Prisma.JoinCodeGetPayload<{
      include: ReturnType<JoinCodesService['includeJoinCode']>;
    }>,
  ) {
    return {
      id: joinCode.id,
      account_id: joinCode.account_id,
      status: joinCode.status,
      max_uses: joinCode.max_uses,
      used_count: joinCode.used_count,
      expires_at: joinCode.expires_at,
      roles: joinCode.roles.map((item) => ({
        id: item.role.id,
        name: item.role.name,
      })),
      branches: joinCode.branches.map((item) => ({
        id: item.branch.id,
        name: item.branch.name,
        city: item.branch.city,
        governorate: item.branch.governorate,
      })),
    };
  }
}
