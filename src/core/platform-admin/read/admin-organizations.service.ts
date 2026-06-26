import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BillingInterval,
  PatientOrgEnrollmentStatus,
  Prisma,
  SubscriptionAddOnStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { paginated } from '@common/utils/pagination.utils.js';
import { OWNER_ROLE_CODE } from '@core/org/organizations/organizations.constants.js';
import { mapAddOns } from './admin-add-on.util.js';
import type { AdminOrganizationsQueryDto } from './dto/admin-list-query.dto.js';
import type {
  AdminOrgBillingDto,
  AdminOrgPortalDto,
  AdminOrganizationDetailDto,
  AdminOrganizationListItemDto,
} from './dto/admin-read-response.dto.js';

type PriceRow = {
  billing_interval: BillingInterval;
  price: Prisma.Decimal;
  currency: string;
};

/**
 * Cross-tenant read of organizations for the admin dashboard. No org-membership
 * gate — the AdminJwtAuthGuard is the only authority (platform admins see every
 * tenant). Folds in branch/staff counts, the current subscription + plan price,
 * the owner contact, and (for detail) per-branch staff, address, and activity.
 */
@Injectable()
export class AdminOrganizationsService {
  constructor(private readonly prismaService: PrismaService) {}

  async list(query: AdminOrganizationsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.OrganizationWhereInput = {
      is_deleted: false,
      ...(query.status ? { status: query.status } : {}),
      ...(query.subscription_status
        ? {
            subscriptions: {
              some: { is_deleted: false, status: query.subscription_status },
            },
          }
        : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };

    const [orgs, total] = await Promise.all([
      this.prismaService.db.organization.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: this.listInclude(),
      }),
      this.prismaService.db.organization.count({ where }),
    ]);

    return paginated(
      orgs.map((o) => this.mapListFields(o)),
      { page, limit, total },
    );
  }

  async get(id: string): Promise<AdminOrganizationDetailDto> {
    const org = await this.prismaService.db.organization.findFirst({
      where: { id, is_deleted: false },
      include: {
        _count: {
          select: {
            branches: { where: { is_deleted: false } },
            profiles: { where: { is_deleted: false, is_active: true } },
            patient_org_enrollments: {
              where: {
                status: PatientOrgEnrollmentStatus.ACTIVE,
                is_deleted: false,
              },
            },
          },
        },
        subscriptions: {
          where: { is_deleted: false },
          orderBy: { created_at: 'desc' },
          take: 1,
          include: {
            subscription_plan: {
              include: {
                prices: { where: { is_active: true, is_deleted: false } },
              },
            },
            add_ons: {
              where: {
                status: SubscriptionAddOnStatus.ACTIVE,
                is_deleted: false,
              },
              include: {
                add_on: {
                  include: {
                    prices: { where: { is_active: true, is_deleted: false } },
                  },
                },
              },
            },
          },
        },
        branches: {
          where: { is_deleted: false },
          orderBy: { is_main: 'desc' },
          select: {
            id: true,
            name: true,
            address: true,
            city: true,
            governorate: true,
            country: true,
            is_main: true,
            _count: {
              select: {
                profileBranches: {
                  where: { profile: { is_active: true, is_deleted: false } },
                },
              },
            },
          },
        },
        profiles: {
          where: {
            is_deleted: false,
            is_active: true,
            role: { code: OWNER_ROLE_CODE },
          },
          take: 1,
          include: { user: true, specialty: true },
        },
        specialty_links: { take: 1, include: { specialty: true } },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const sub = org.subscriptions[0] ?? null;
    const plan = sub?.subscription_plan ?? null;
    const billing = plan ? this.priceInfo(plan.prices) : null;
    const main = org.branches[0] ?? null;
    const activity = await this.prismaService.db.adminNotification.findMany({
      where: { organization_id: id },
      orderBy: { created_at: 'desc' },
      take: 5,
      select: { type: true, title: true, body: true, created_at: true },
    });

    const portal = await this.portalStats(
      id,
      org._count.patient_org_enrollments,
    );

    return {
      ...this.mapListFields(org),
      subscription_ends_at: sub?.ends_at ?? null,
      trial_ends_at: sub?.trial_ends_at ?? null,
      owner: org.profiles[0]
        ? {
            full_name:
              `${org.profiles[0].user.first_name} ${org.profiles[0].user.last_name}`.trim(),
            email: org.profiles[0].user.email,
            phone: org.profiles[0].user.phone_number,
            specialty: org.profiles[0].specialty?.name ?? null,
          }
        : null,
      billing,
      plan_limits: plan
        ? { max_branches: plan.max_branches, max_staff: plan.max_staff }
        : null,
      branches: org.branches.map((b) => ({
        id: b.id,
        name: b.name,
        city: b.city,
        governorate: b.governorate,
        staff_count: b._count.profileBranches,
        is_main: b.is_main,
      })),
      address: main
        ? {
            address: main.address,
            governorate: main.governorate,
            country: main.country,
          }
        : null,
      recent_activity: activity,
      portal,
      add_ons: sub ? mapAddOns(sub.add_ons, billing?.interval ?? null) : [],
    };
  }

  /**
   * Patient-portal adoption for one org. `enrolled` comes from the org `_count`
   * (distinct ACTIVE enrollments); the rest are keyed to those patients. Portal
   * accounts are patient-only (guardians are proxies, excluded). "Active this
   * month" = distinct enrolled patients with a Visit check-in since the 1st,
   * deduped in TS since Prisma `distinct` can't span the visit→episode→journey
   * relation.
   */
  private async portalStats(
    organizationId: string,
    enrolled: number,
  ): Promise<AdminOrgPortalDto> {
    const db = this.prismaService.db;
    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const enrollments = await db.patientOrgEnrollment.findMany({
      where: {
        organization_id: organizationId,
        status: PatientOrgEnrollmentStatus.ACTIVE,
        is_deleted: false,
      },
      select: { patient_id: true },
    });
    const patientIds = enrollments.map((e) => e.patient_id);

    const [portal_accounts, active_accounts, monthVisits] = await Promise.all([
      patientIds.length
        ? db.patientAccount.count({
            where: { is_deleted: false, patient_id: { in: patientIds } },
          })
        : Promise.resolve(0),
      patientIds.length
        ? db.patientAccount.count({
            where: {
              is_deleted: false,
              is_active: true,
              patient_id: { in: patientIds },
            },
          })
        : Promise.resolve(0),
      db.visit.findMany({
        where: {
          is_deleted: false,
          checked_in_at: { gte: startOfThisMonth },
          branch: { organization_id: organizationId },
        },
        select: {
          episode: { select: { journey: { select: { patient_id: true } } } },
        },
      }),
    ]);

    const activePatients = new Set(
      monthVisits.map((v) => v.episode.journey.patient_id),
    );

    return {
      enrolled_patients: enrolled,
      portal_accounts,
      active_accounts,
      activation_rate:
        enrolled > 0 ? round2((portal_accounts / enrolled) * 100) : null,
      active_this_month: activePatients.size,
    };
  }

  private listInclude() {
    return {
      _count: {
        select: {
          branches: { where: { is_deleted: false } },
          profiles: { where: { is_deleted: false, is_active: true } },
          patient_org_enrollments: {
            where: {
              status: PatientOrgEnrollmentStatus.ACTIVE,
              is_deleted: false,
            },
          },
        },
      },
      subscriptions: {
        where: { is_deleted: false },
        orderBy: { created_at: 'desc' as const },
        take: 1,
        include: {
          subscription_plan: {
            include: {
              prices: { where: { is_active: true, is_deleted: false } },
            },
          },
        },
      },
      branches: {
        where: { is_deleted: false },
        orderBy: { is_main: 'desc' as const },
        take: 1,
        select: { city: true },
      },
      profiles: {
        where: {
          is_deleted: false,
          is_active: true,
          role: { code: OWNER_ROLE_CODE },
        },
        take: 1,
        include: { user: true, specialty: true },
      },
      specialty_links: { take: 1, include: { specialty: true } },
    } satisfies Prisma.OrganizationInclude;
  }

  private mapListFields(org: {
    id: string;
    name: string;
    status: AdminOrganizationListItemDto['status'];
    created_at: Date;
    _count: {
      branches: number;
      profiles: number;
      patient_org_enrollments: number;
    };
    subscriptions: {
      status: string;
      subscription_plan: {
        plan: string;
        max_branches: number;
        max_staff: number;
        prices: PriceRow[];
      };
    }[];
    branches: { city: string }[];
    profiles: {
      user: { first_name: string; last_name: string; email: string | null };
      specialty: { name: string } | null;
    }[];
    specialty_links: { specialty: { name: string } }[];
  }): AdminOrganizationListItemDto {
    const sub = org.subscriptions[0] ?? null;
    const plan = sub?.subscription_plan ?? null;
    const owner = org.profiles[0] ?? null;
    const billing = plan ? this.priceInfo(plan.prices) : null;
    return {
      id: org.id,
      name: org.name,
      status: org.status,
      branch_count: org._count.branches,
      staff_count: org._count.profiles,
      enrolled_patients: org._count.patient_org_enrollments,
      subscription_status:
        (sub?.status as AdminOrganizationListItemDto['subscription_status']) ??
        null,
      plan: plan?.plan ?? null,
      city: org.branches[0]?.city ?? null,
      specialty: org.specialty_links[0]?.specialty.name ?? null,
      primary_contact_name: owner
        ? `${owner.user.first_name} ${owner.user.last_name}`.trim()
        : null,
      primary_contact_email: owner?.user.email ?? null,
      mrr:
        sub?.status === SubscriptionStatus.ACTIVE
          ? this.monthlyEquivalent(billing)
          : null,
      branch_limit: plan?.max_branches ?? null,
      staff_limit: plan?.max_staff ?? null,
      created_at: org.created_at,
    };
  }

  /** Active plan price, preferring a monthly tier, else the yearly tier. */
  private priceInfo(prices: PriceRow[]): AdminOrgBillingDto | null {
    const monthly = prices.find(
      (p) => p.billing_interval === BillingInterval.MONTHLY,
    );
    if (monthly) {
      return {
        amount: round2(Number(monthly.price)),
        currency: monthly.currency,
        interval: 'MONTHLY',
      };
    }
    const yearly = prices.find(
      (p) => p.billing_interval === BillingInterval.YEARLY,
    );
    if (yearly) {
      return {
        amount: round2(Number(yearly.price)),
        currency: yearly.currency,
        interval: 'YEARLY',
      };
    }
    return null;
  }

  /** Monthly-equivalent figure for MRR (yearly prices divided by 12). */
  private monthlyEquivalent(billing: AdminOrgBillingDto | null): number | null {
    if (!billing) return null;
    return billing.interval === 'YEARLY'
      ? round2(billing.amount / 12)
      : billing.amount;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
