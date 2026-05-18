import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { VisitsService } from '@core/clinical/visits/visits.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';

const SYSTEM_AUTH_CONTEXT: AuthContext = {
  userId: 'system',
  profileId: 'system',
  organizationId: 'system',
  roles: ['SYSTEM'],
  branchIds: [],
};

@Injectable()
export class PatientEnrollmentCleanupService {
  private readonly logger = new Logger(PatientEnrollmentCleanupService.name);

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
      select: { id: true },
    });

    this.logger.log(`Sweeping ${overdueVisits.length} overdue visits`);

    for (const visit of overdueVisits) {
      await this.visitsService.updateStatus(
        visit.id,
        { status: 'NO_SHOW' },
        SYSTEM_AUTH_CONTEXT,
      );
    }
  }
}
