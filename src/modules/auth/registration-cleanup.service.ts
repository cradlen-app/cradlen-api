import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service.js';

const PENDING_USER_TTL_HOURS = 24;

@Injectable()
export class RegistrationCleanupService {
  constructor(private readonly prismaService: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupStalePendingUsers(): Promise<void> {
    const cutoff = new Date(
      Date.now() - PENDING_USER_TTL_HOURS * 60 * 60 * 1000,
    );
    await this.prismaService.db.user.deleteMany({
      where: {
        registration_status: 'PENDING',
        created_at: { lt: cutoff },
      },
    });
  }
}
