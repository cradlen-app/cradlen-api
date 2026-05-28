import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

const PENDING_USER_TTL_HOURS = 24;
const REFRESH_TOKEN_GRACE_DAYS = 30;
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

        // Hard delete intentional: PENDING users have no committed data.
        // Cascade on User→VerificationCode and User→RefreshToken cleans child rows.
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

  /**
   * Hard-deletes RefreshToken rows that no client could legitimately
   * present any more: either expired by JWT clock, or revoked, with a
   * grace window so very recent rotations remain inspectable while
   * debugging an incident.
   *
   * Runs daily because the table grows ~one row per login + one per
   * refresh; the data is otherwise unbounded.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredRefreshTokens(): Promise<void> {
    try {
      const cutoff = new Date(
        Date.now() - REFRESH_TOKEN_GRACE_DAYS * 24 * 60 * 60 * 1000,
      );
      const { count } = await this.prismaService.db.refreshToken.deleteMany({
        where: {
          OR: [
            { expires_at: { lt: cutoff } },
            { is_revoked: true, revoked_at: { lt: cutoff } },
          ],
        },
      });
      this.logger.log(`Cleaned ${count} stale refresh tokens`);
    } catch (error) {
      this.logger.error(
        'Failed to clean stale refresh tokens',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
