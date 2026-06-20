import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';

/** Job functions that may run cashier-style billing actions (besides OWNER). */
const BILLING_JOB_FUNCTIONS = ['RECEPTIONIST', 'ACCOUNTANT'];

/**
 * Front-desk billing gate shared across the invoicing / payments / refunds
 * sub-modules: an OWNER or BRANCH_MANAGER, or a RECEPTIONIST / ACCOUNTANT within
 * the organization, may run cashier-style actions (create invoices, record
 * payments, …). Branch managers are further limited to their own branch(es) by
 * the per-action `assertCanAccessBranch` guard at each mutation site. Mirrors the
 * web client's `canAccessBilling` predicate.
 */
@Injectable()
export class FinancialAccessService {
  constructor(private readonly prismaService: PrismaService) {}

  async assertCanRunBillingAction(
    user: AuthContext,
    organizationId: string,
  ): Promise<void> {
    // The OWNER / BRANCH_MANAGER short-circuit must be scoped to the caller's own
    // organization — `user.role` is the role for the token's active org, so a
    // manager of one org must not pass this gate for a different org in the route
    // param. Branch managers are limited to their own branch(es) by the
    // per-action `assertCanAccessBranch` call at each mutation site, not here.
    if (
      (user.role === 'OWNER' || user.role === 'BRANCH_MANAGER') &&
      user.organizationId === organizationId
    ) {
      return;
    }

    const billingStaff = await this.prismaService.db.profile.findFirst({
      where: {
        id: user.profileId,
        organization_id: organizationId,
        is_deleted: false,
        job_function: { code: { in: BILLING_JOB_FUNCTIONS } },
      },
      select: { id: true },
    });

    if (!billingStaff) {
      throw new BadRequestException(
        'Only RECEPTIONISTs, ACCOUNTANTs, or OWNERs can perform this action',
      );
    }
  }

  /**
   * Reject invoice items naming a service the assigned doctor isn't authorized
   * to deliver. Authorization = an active `ProviderService` for the profile at
   * the invoice's branch or org-wide. Items without a `service_id` (custom/free
   * lines) are skipped — there's nothing to authorize against. Mirrors the
   * single-service predicate in ProviderServicesService.assertProviderAuthorized.
   */
  async assertProviderAuthorizedForItems(
    organizationId: string,
    profileId: string,
    branchId: string,
    items: { service_id?: string | null }[],
  ): Promise<void> {
    const serviceIds = [
      ...new Set(
        items.map((item) => item.service_id).filter((id): id is string => !!id),
      ),
    ];
    if (serviceIds.length === 0) return;

    const authorized = await this.prismaService.db.providerService.findMany({
      where: {
        organization_id: organizationId,
        profile_id: profileId,
        service_id: { in: serviceIds },
        is_active: true,
        is_deleted: false,
        OR: [{ branch_id: branchId }, { branch_id: null }],
      },
      select: { service_id: true },
    });
    const authorizedIds = new Set(authorized.map((row) => row.service_id));

    const missing = serviceIds.filter((id) => !authorizedIds.has(id));
    if (missing.length === 0) return;

    const services = await this.prismaService.db.service.findMany({
      where: { id: { in: missing } },
      select: { name: true, code: true },
    });
    const labels = services.map((svc) => `${svc.name} (${svc.code})`);
    const detail = labels.length > 0 ? labels.join(', ') : missing.join(', ');
    throw new BadRequestException(
      `Doctor is not authorized for: ${detail}. Authorize the service for this provider first.`,
    );
  }
}
