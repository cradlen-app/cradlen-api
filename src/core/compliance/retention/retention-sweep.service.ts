import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigType } from '@nestjs/config';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import complianceConfig from '@config/compliance.config.js';

const DAY_MS = 86_400_000;

/**
 * Nightly retention sweep. Prunes audit-trail rows past their configured
 * windows. Entirely inert unless `RETENTION_SWEEP_ENABLED=true` AND a positive
 * window is set for a table (a `0` window = keep forever). Retention periods are
 * a legal decision — the defaults keep everything.
 *
 * Deliberately does NOT auto-anonymize patient clinical records: that is
 * legally sensitive and stays on the admin-triggered ErasureService path. Uses
 * `baseClient` (system job, no request/tenant context).
 */
@Injectable()
export class RetentionSweepService {
  private readonly logger = new Logger(RetentionSweepService.name);

  constructor(
    private readonly prismaService: PrismaService,
    @Inject(complianceConfig.KEY)
    private readonly config: ConfigType<typeof complianceConfig>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async sweep(): Promise<void> {
    if (!this.config.retention.enabled) return;
    const { phiAccessLogDays, authAuditLogDays, adminAuditLogDays } =
      this.config.retention;

    await this.prunePhiAccessLog(phiAccessLogDays);
    await this.pruneAuthAuditLog(authAuditLogDays);
    await this.pruneAdminAuditLog(adminAuditLogDays);
  }

  private cutoff(days: number): Date {
    return new Date(Date.now() - days * DAY_MS);
  }

  private async prunePhiAccessLog(days: number): Promise<void> {
    if (days <= 0) return;
    try {
      const res = await this.prismaService.baseClient.phiAccessLog.deleteMany({
        where: { at: { lt: this.cutoff(days) } },
      });
      this.logger.log(`retention: pruned ${res.count} phi_access_log rows`);
    } catch (err) {
      this.logger.error({
        message: 'retention phi_access_log prune failed',
        err,
      });
    }
  }

  private async pruneAuthAuditLog(days: number): Promise<void> {
    if (days <= 0) return;
    try {
      const res = await this.prismaService.baseClient.authAuditLog.deleteMany({
        where: { created_at: { lt: this.cutoff(days) } },
      });
      this.logger.log(`retention: pruned ${res.count} auth_audit_log rows`);
    } catch (err) {
      this.logger.error({
        message: 'retention auth_audit_log prune failed',
        err,
      });
    }
  }

  private async pruneAdminAuditLog(days: number): Promise<void> {
    if (days <= 0) return;
    try {
      const res = await this.prismaService.baseClient.adminAuditLog.deleteMany({
        where: { created_at: { lt: this.cutoff(days) } },
      });
      this.logger.log(`retention: pruned ${res.count} admin_audit_log rows`);
    } catch (err) {
      this.logger.error({
        message: 'retention admin_audit_log prune failed',
        err,
      });
    }
  }
}
