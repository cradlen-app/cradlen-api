import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

/**
 * Stamps `last_active_at` on the authenticated entity, throttled to at most one
 * write per entity per UTC day. The throttle is the `where` clause itself: a
 * single conditional `updateMany` that matches zero rows (and writes nothing)
 * once the entity has already been stamped today. Callers invoke this
 * fire-and-forget from the JWT strategies, so it must never throw into the auth
 * path — every method swallows its own errors.
 */
@Injectable()
export class LastActiveService {
  constructor(private readonly prismaService: PrismaService) {}

  async touchUser(id: string): Promise<void> {
    const now = new Date();
    try {
      await this.prismaService.db.user.updateMany({
        where: this.staleToday(id, now),
        data: { last_active_at: now },
      });
    } catch {
      // Best-effort heartbeat: never disturb the request it piggybacks on.
    }
  }

  async touchPatientAccount(id: string): Promise<void> {
    const now = new Date();
    try {
      await this.prismaService.db.patientAccount.updateMany({
        where: this.staleToday(id, now),
        data: { last_active_at: now },
      });
    } catch {
      // Best-effort heartbeat: never disturb the request it piggybacks on.
    }
  }

  /**
   * Matches the row only when it hasn't been stamped yet today (UTC) — so the
   * update writes at most once per entity per day and otherwise affects 0 rows.
   */
  private staleToday(id: string, now: Date) {
    const startOfTodayUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    return {
      id,
      OR: [
        { last_active_at: null },
        { last_active_at: { lt: startOfTodayUtc } },
      ],
    };
  }
}
