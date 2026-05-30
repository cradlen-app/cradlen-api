import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { VisitsService } from '@core/clinical/visits/visits.service.js';
import { AuthContext } from '@common/interfaces/auth-context.interface.js';

const SYSTEM_AUTH_CONTEXT: AuthContext = {
  userId: 'system',
  profileId: 'system',
  organizationId: 'system',
  roles: ['SYSTEM'],
  branchIds: [],
};

/**
 * Nightly sweep that marks past-due, never-checked-in SCHEDULED visits as
 * NO_SHOW so they stop appearing as upcoming appointments.
 */
@Injectable()
export class OverdueVisitSweepService {
  private readonly logger = new Logger(OverdueVisitSweepService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly visitsService: VisitsService,
  ) {}

  @Cron('0 2 * * *')
  async sweepOverdueVisits(): Promise<void> {
    const now = new Date();
    const overdueVisits = await this.prismaService.db.visit.findMany({
      where: {
        status: 'SCHEDULED',
        scheduled_at: { lt: now },
        checked_in_at: null,
        is_deleted: false,
      },
      select: {
        id: true,
        episode: {
          select: {
            journey: {
              select: { organization_id: true },
            },
          },
        },
      },
    });

    this.logger.log(`Sweeping ${overdueVisits.length} overdue visits`);

    for (const visit of overdueVisits) {
      const organizationId = visit.episode?.journey?.organization_id;
      if (!organizationId) continue;

      const visitAuthContext: AuthContext = {
        ...SYSTEM_AUTH_CONTEXT,
        organizationId,
      };

      try {
        await this.visitsService.updateStatus(
          visit.id,
          { status: 'NO_SHOW' },
          visitAuthContext,
        );
      } catch (err) {
        this.logger.error(
          `Failed to mark visit ${visit.id} as NO_SHOW`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }
}
