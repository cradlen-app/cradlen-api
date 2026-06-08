import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { StorageService } from '@infrastructure/storage/storage.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import type { AuthTokensDto } from '../dto/auth-tokens.dto.js';
import type { LoginDto } from '../dto/login.dto.js';
import type { RefreshDto } from '../dto/refresh.dto.js';
import type { SelectProfileDto } from '../dto/select-profile.dto.js';
import type { SwitchBranchDto } from '../dto/switch-branch.dto.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { TokensService } from './tokens.service.js';
import {
  AUTH_EVENTS,
  type AuthLoginFailedPayload,
  type AuthLoginSucceededPayload,
} from '../events/auth.events.js';

export interface SelectableProfile {
  profile_id: string;
  organization_id: string;
  organization_name: string;
  roles: string[];
  branches: {
    branch_id: string;
    name: string;
    is_main: boolean;
  }[];
}

export interface ProfileSelectionResponse {
  type: 'profile_selection';
  selection_token: string;
  profiles: SelectableProfile[];
}

export interface OnboardingRequiredResponse {
  type: 'ONBOARDING_REQUIRED';
  step: 'VERIFY_OTP' | 'COMPLETE_ONBOARDING';
}

@Injectable()
export class SessionsService {
  /**
   * How long after a refresh token is rotated it may still be redeemed once
   * more, to absorb concurrent refresh requests racing the same token (see
   * `refresh`). Short enough to keep single-use rotation meaningful.
   */
  private static readonly REFRESH_REUSE_GRACE_MS = 60_000;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly tokensService: TokensService,
    private readonly eventBus: EventBus,
    private readonly storageService: StorageService,
  ) {}

  async login(
    dto: LoginDto,
  ): Promise<ProfileSelectionResponse | OnboardingRequiredResponse> {
    const user = await this.prismaService.db.user.findFirst({
      // Staff login only — patient/guardian accounts authenticate via
      // /v1/patient-auth/login. (They have email=null today, so this is
      // defensive, but keeps the two identity spaces strictly separate.)
      where: {
        email: dto.email,
        is_deleted: false,
        patient_id: null,
        guardian_id: null,
      },
    });
    if (!user?.password_hashed) {
      this.publishLoginFailure(dto.email, 'not_found');
      throw new UnauthorizedException('Invalid credentials');
    }
    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.password_hashed,
    );
    if (!passwordMatches) {
      this.publishLoginFailure(dto.email, 'invalid_credentials');
      throw new UnauthorizedException('Invalid credentials');
    }
    const succeededPayload: AuthLoginSucceededPayload = {
      user_id: user.id,
      email: dto.email,
      at: new Date(),
    };
    this.eventBus.publish(AUTH_EVENTS.login.succeeded, succeededPayload);
    return this.buildLoginResponse(user);
  }

  private publishLoginFailure(
    email: string,
    reason: AuthLoginFailedPayload['reason'],
  ): void {
    const payload: AuthLoginFailedPayload = {
      email,
      reason,
      at: new Date(),
    };
    this.eventBus.publish(AUTH_EVENTS.login.failed, payload);
  }

  async selectProfile(dto: SelectProfileDto): Promise<AuthTokensDto> {
    const userId = this.tokensService.decodeSignupToken(
      dto.selection_token,
      'profile_selection',
    );
    const profile = await this.prismaService.db.profile.findFirst({
      where: {
        id: dto.profile_id,
        user_id: userId,
        is_deleted: false,
        is_active: true,
        organization: { status: 'ACTIVE', is_deleted: false },
      },
      include: { user: true },
    });
    if (!profile) throw new ForbiddenException('Invalid profile selection');

    const effectiveBranchIds =
      await this.authorizationService.getEffectiveBranchIds(
        profile.id,
        profile.organization_id,
      );
    const branches = await this.prismaService.db.branch.findMany({
      where: {
        id: { in: effectiveBranchIds },
        organization_id: profile.organization_id,
        status: 'ACTIVE',
        is_deleted: false,
      },
      orderBy: { created_at: 'asc' },
    });

    const branchId = this.resolveSelectedBranchId(
      branches.map((b) => ({ branch_id: b.id })),
      dto.branch_id,
    );

    const selectedBranch = branches.find((b) => b.id === branchId);
    if (!selectedBranch) {
      throw new ForbiddenException('Invalid branch selection');
    }

    return this.tokensService.issueTokenPair({
      user: profile.user,
      profileId: profile.id,
      organizationId: profile.organization_id,
      activeBranchId: branchId,
    });
  }

  async refresh(dto: RefreshDto): Promise<AuthTokensDto> {
    const payload = this.tokensService.decodeRefreshToken(dto.refresh_token);

    const stored = await this.prismaService.db.refreshToken.findUnique({
      where: { jti: payload.jti },
      include: { user: true },
    });
    if (!stored || stored.expires_at < new Date()) {
      throw new UnauthorizedException('Refresh token revoked or expired');
    }

    // Rotation-race grace: when a page makes several authenticated calls at
    // once after the access token expired, each tries to rotate the *same*
    // refresh token. The first wins and revokes it; without a grace window the
    // losers present a now-revoked token and get logged out. A token revoked
    // *by rotation* (replaced_by_jti set) is honored once more within a short
    // window. Logout-revoked tokens (replaced_by_jti null) are never honored.
    const rotatedWithinGrace =
      stored.is_revoked &&
      !!stored.replaced_by_jti &&
      !!stored.revoked_at &&
      Date.now() - stored.revoked_at.getTime() <=
        SessionsService.REFRESH_REUSE_GRACE_MS;

    if (stored.is_revoked && !rotatedWithinGrace) {
      throw new UnauthorizedException('Refresh token revoked or expired');
    }

    const matches = await bcrypt.compare(dto.refresh_token, stored.token_hash);
    if (!matches) throw new UnauthorizedException('Refresh token mismatch');
    if (!stored.profile_id || !stored.organization_id) {
      throw new UnauthorizedException('Refresh token has no profile context');
    }

    return this.tokensService.issueTokenPair({
      user: stored.user,
      profileId: stored.profile_id,
      organizationId: stored.organization_id,
      activeBranchId: stored.active_branch_id ?? undefined,
      // Already revoked by the winning rotation — issue a fresh pair off the
      // same context without trying to revoke it again.
      ...(rotatedWithinGrace ? {} : { revokeJti: stored.jti }),
    });
  }

  logout(rawRefreshToken: string): Promise<void> {
    return this.tokensService.revokeRefreshToken(rawRefreshToken);
  }

  async switchBranch(
    user: AuthContext,
    dto: SwitchBranchDto,
  ): Promise<AuthTokensDto> {
    const canAccess = await this.authorizationService.canAccessBranch(
      user.profileId,
      user.organizationId,
      dto.branch_id,
    );
    if (!canAccess) throw new ForbiddenException('Branch access denied');

    return this.tokensService.issueTokenPair({
      user: { id: user.userId },
      profileId: user.profileId,
      organizationId: user.organizationId,
      activeBranchId: dto.branch_id,
    });
  }

  async getMe(userId: string, profileId: string) {
    const user = await this.prismaService.db.user.findFirst({
      where: { id: userId, is_deleted: false },
      include: {
        profiles: {
          where: { id: profileId, is_deleted: false },
          include: {
            organization: {
              include: {
                specialty_links: { include: { specialty: true } },
              },
            },
            roles: { include: { role: true } },
            job_functions: { include: { job_function: true } },
            specialty_links: { include: { specialty: true } },
          },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');

    // The `profiles: { where: { id: profileId } }` filter above limits this
    // to at most one profile. Classify OWNER vs member in-memory using the
    // roles we already pulled instead of round-tripping through
    // AuthorizationService.getEffectiveBranchIds (which would issue an
    // extra hasAnyRole query per profile).
    const profilesWithBranches = await Promise.all(
      user.profiles.map(async (profile) => {
        const isOwner = profile.roles.some((pr) => pr.role.name === 'OWNER');
        const branches = isOwner
          ? await this.prismaService.db.branch.findMany({
              where: {
                organization_id: profile.organization_id,
                is_deleted: false,
              },
              orderBy: { created_at: 'asc' },
            })
          : await (async () => {
              const links = await this.prismaService.db.profileBranch.findMany({
                where: {
                  profile_id: profile.id,
                  organization_id: profile.organization_id,
                },
                select: { branch_id: true },
              });
              if (links.length === 0) return [];
              return this.prismaService.db.branch.findMany({
                where: {
                  id: { in: links.map((l) => l.branch_id) },
                  organization_id: profile.organization_id,
                  is_deleted: false,
                },
                orderBy: { created_at: 'asc' },
              });
            })();
        const profile_image_url = profile.profile_image_object_key
          ? await this.storageService.createPresignedDownloadUrl(
              profile.profile_image_object_key,
            )
          : null;
        return { profile, branches, profile_image_url };
      }),
    );

    return {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      phone_number: user.phone_number,
      is_active: user.is_active,
      verified_at: user.verified_at,
      created_at: user.created_at,
      profiles: profilesWithBranches.map(
        ({ profile, branches, profile_image_url }) => ({
          staff_id: profile.id,
          executive_title: profile.executive_title,
          engagement_type: profile.engagement_type,
          organization: {
            id: profile.organization.id,
            name: profile.organization.name,
            specialties: profile.organization.specialty_links.map((l) => ({
              id: l.specialty.id,
              code: l.specialty.code,
              name: l.specialty.name,
            })),
            status: profile.organization.status,
          },
          roles: profile.roles.map((pr) => ({
            id: pr.role.id,
            name: pr.role.name,
          })),
          branches: branches.map((b) => ({
            id: b.id,
            name: b.name,
            address: b.address,
            city: b.city,
            governorate: b.governorate,
            country: b.country,
            is_main: b.is_main,
          })),
          job_functions: profile.job_functions.map((jf) => ({
            id: jf.job_function.id,
            code: jf.job_function.code,
            name: jf.job_function.name,
            is_clinical: jf.job_function.is_clinical,
          })),
          specialties: profile.specialty_links.map((sl) => ({
            id: sl.specialty.id,
            code: sl.specialty.code,
            name: sl.specialty.name,
          })),
          profile_image_url,
        }),
      ),
    };
  }

  async buildProfileSelectionResponse(
    userId: string,
  ): Promise<ProfileSelectionResponse> {
    const profiles = await this.getSelectableProfiles(userId);
    return {
      type: 'profile_selection',
      selection_token: this.tokensService.issueSignupToken(
        userId,
        'profile_selection',
      ).signup_token,
      profiles,
    };
  }

  private async buildLoginResponse(
    user: User,
  ): Promise<ProfileSelectionResponse | OnboardingRequiredResponse> {
    if (!user.is_active) throw new UnauthorizedException('User is inactive');
    if (user.registration_status === 'PENDING') {
      return {
        type: 'ONBOARDING_REQUIRED',
        step: 'VERIFY_OTP',
      };
    }
    if (user.registration_status !== 'ACTIVE') {
      throw new ForbiddenException('User registration is not active');
    }
    if (!user.onboarding_completed) {
      return {
        type: 'ONBOARDING_REQUIRED',
        step: 'COMPLETE_ONBOARDING',
      };
    }

    return this.buildProfileSelectionResponse(user.id);
  }

  private async getSelectableProfiles(
    userId: string,
  ): Promise<SelectableProfile[]> {
    // Single query for all of the user's active profiles in active orgs,
    // including the roles needed to classify OWNER vs member in-memory.
    const profiles = await this.prismaService.db.profile.findMany({
      where: {
        user_id: userId,
        is_deleted: false,
        is_active: true,
        organization: { is_deleted: false, status: 'ACTIVE' },
      },
      include: {
        organization: true,
        roles: { include: { role: true } },
      },
      orderBy: { created_at: 'asc' },
    });

    if (profiles.length === 0) return [];

    const ownerProfileIds = new Set<string>();
    const ownerOrgIds = new Set<string>();
    const memberProfileIds: string[] = [];
    for (const profile of profiles) {
      const isOwner = profile.roles.some((pr) => pr.role.name === 'OWNER');
      if (isOwner) {
        ownerProfileIds.add(profile.id);
        ownerOrgIds.add(profile.organization_id);
      } else {
        memberProfileIds.push(profile.id);
      }
    }

    // OWNER: all active branches in their orgs (single query, covers any
    // number of owned organizations).
    const ownerBranches =
      ownerOrgIds.size > 0
        ? await this.prismaService.db.branch.findMany({
            where: {
              organization_id: { in: [...ownerOrgIds] },
              status: 'ACTIVE',
              is_deleted: false,
            },
            orderBy: { created_at: 'asc' },
          })
        : [];
    const ownerBranchesByOrg = new Map<string, typeof ownerBranches>();
    for (const branch of ownerBranches) {
      const list = ownerBranchesByOrg.get(branch.organization_id) ?? [];
      list.push(branch);
      ownerBranchesByOrg.set(branch.organization_id, list);
    }

    // Member: assigned branches via ProfileBranch (single link query
    // + single branch detail query, regardless of profile count).
    const memberLinks =
      memberProfileIds.length > 0
        ? await this.prismaService.db.profileBranch.findMany({
            where: { profile_id: { in: memberProfileIds } },
            select: { branch_id: true, profile_id: true },
          })
        : [];
    const memberBranchIds = [...new Set(memberLinks.map((l) => l.branch_id))];
    const memberBranches =
      memberBranchIds.length > 0
        ? await this.prismaService.db.branch.findMany({
            where: {
              id: { in: memberBranchIds },
              status: 'ACTIVE',
              is_deleted: false,
            },
            orderBy: { created_at: 'asc' },
          })
        : [];
    const memberBranchById = new Map(memberBranches.map((b) => [b.id, b]));
    const memberBranchesByProfile = new Map<string, typeof memberBranches>();
    for (const link of memberLinks) {
      const branch = memberBranchById.get(link.branch_id);
      if (!branch) continue;
      const list = memberBranchesByProfile.get(link.profile_id) ?? [];
      list.push(branch);
      memberBranchesByProfile.set(link.profile_id, list);
    }

    return profiles.map((profile) => {
      const isOwner = ownerProfileIds.has(profile.id);
      const branches = isOwner
        ? (ownerBranchesByOrg.get(profile.organization_id) ?? [])
        : (memberBranchesByProfile.get(profile.id) ?? []);
      return {
        profile_id: profile.id,
        organization_id: profile.organization.id,
        organization_name: profile.organization.name,
        roles: profile.roles.map((item) => item.role.code),
        branches: branches.map((b) => ({
          branch_id: b.id,
          name: b.name,
          is_main: b.is_main,
        })),
      };
    });
  }

  private resolveSelectedBranchId(
    branches: { branch_id: string }[],
    branchId?: string,
  ): string {
    if (branchId) return branchId;
    if (branches.length === 1) return branches[0].branch_id;
    throw new BadRequestException('branch_id is required');
  }
}
