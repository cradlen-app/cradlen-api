import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service.js';

const PENDING_USER_TTL_HOURS = 24;
const CLEANUP_BATCH_SIZE = 500;

@Injectable()
export class RegistrationCleanupService {
  private readonly logger = new Logger(RegistrationCleanupService.name);

  constructor(private readonly prismaService: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupStalePendingUsers(): Promise<void> {
    try {
      const cutoff = new Date(
        Date.now() - PENDING_USER_TTL_HOURS * 60 * 60 * 1000,
      );
      let totalDeleted = 0;

      while (true) {
        const staleUsers = await this.prismaService.db.user.findMany({
          where: {
            registration_status: 'PENDING',
            created_at: { lt: cutoff },
          },
          select: { id: true },
          take: CLEANUP_BATCH_SIZE,
        });
        if (staleUsers.length === 0) break;

        const deleted = await this.prismaService.db.user.deleteMany({
          where: { id: { in: staleUsers.map((user) => user.id) } },
        });
        totalDeleted += deleted.count;
        if (staleUsers.length < CLEANUP_BATCH_SIZE) break;
      }

      this.logger.log(`Cleaned ${totalDeleted} stale pending registrations`);
    } catch (error) {
      this.logger.error(
        'Failed to clean stale pending registrations',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
