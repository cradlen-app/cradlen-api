import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';

/**
 * Front-desk billing gate shared across the invoicing / payments / refunds
 * sub-modules: an OWNER, or a RECEPTIONIST within the organization, may run
 * cashier-style actions (create invoices, record payments, …).
 */
@Injectable()
export class FinancialAccessService {
  constructor(private readonly prismaService: PrismaService) {}

  async assertIsReceptionistOrOwner(
    user: AuthContext,
    organizationId: string,
  ): Promise<void> {
    // The OWNER short-circuit must be scoped to the caller's own organization —
    // `user.role` is the role for the token's active org, so an OWNER of one
    // org must not pass this gate for a different org in the route param.
    if (user.role === 'OWNER' && user.organizationId === organizationId) {
      return;
    }

    const receptionist = await this.prismaService.db.profile.findFirst({
      where: {
        id: user.profileId,
        organization_id: organizationId,
        is_deleted: false,
        job_function: { code: 'RECEPTIONIST' },
      },
      select: { id: true },
    });

    if (!receptionist) {
      throw new BadRequestException(
        'Only RECEPTIONISTs or OWNERs can perform this action',
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
