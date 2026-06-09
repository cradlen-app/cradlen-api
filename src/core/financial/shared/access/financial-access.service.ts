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
    // `user.roles` are the roles for the token's active org, so an OWNER of one
    // org must not pass this gate for a different org in the route param.
    if (
      user.roles.includes('OWNER') &&
      user.organizationId === organizationId
    ) {
      return;
    }

    const jobFunction =
      await this.prismaService.db.profileJobFunction.findFirst({
        where: {
          profile_id: user.profileId,
          job_function: { code: 'RECEPTIONIST' },
          profile: { organization_id: organizationId, is_deleted: false },
        },
      });

    if (!jobFunction) {
      throw new BadRequestException(
        'Only RECEPTIONISTs or OWNERs can perform this action',
      );
    }
  }
}
