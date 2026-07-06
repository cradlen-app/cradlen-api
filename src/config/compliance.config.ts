import { registerAs } from '@nestjs/config';

function nonNegInt(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

export interface ComplianceConfig {
  /** Where tenant data physically resides — surfaced in the residency doc/policy. */
  residency: {
    dataRegion: string;
    fileRegion: string;
  };
  /**
   * Retention windows (in days) for the audit trails. `0` = keep forever (the
   * safe default — the retention sweep skips a table with a 0 window). The
   * periods are a LEGAL decision; nothing is pruned unless `enabled` is set AND a
   * positive window is configured.
   */
  retention: {
    enabled: boolean;
    phiAccessLogDays: number;
    authAuditLogDays: number;
    adminAuditLogDays: number;
  };
  /** Base64 32-byte key for application-layer field encryption (staged; see field-crypto). */
  fieldEncryptionKey?: string;
}

export default registerAs('compliance', (): ComplianceConfig => {
  const fieldEncryptionKey = process.env.FIELD_ENCRYPTION_KEY;
  // Fail-safe: once national_id encryption ships, production MUST carry the key —
  // without it, writes stay plaintext and national_id uniqueness (moved to the
  // blind index) is not enforced. Optional in dev/test.
  if (process.env.NODE_ENV === 'production' && !fieldEncryptionKey) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY is required in production (Patient.national_id encryption).',
    );
  }
  return {
    residency: {
      dataRegion: process.env.DATA_REGION ?? 'eu-central-1',
      fileRegion: process.env.FILE_REGION ?? 'weur',
    },
    retention: {
      enabled: process.env.RETENTION_SWEEP_ENABLED === 'true',
      phiAccessLogDays: nonNegInt('RETENTION_PHI_ACCESS_LOG_DAYS', 0),
      authAuditLogDays: nonNegInt('RETENTION_AUTH_AUDIT_LOG_DAYS', 0),
      adminAuditLogDays: nonNegInt('RETENTION_ADMIN_AUDIT_LOG_DAYS', 0),
    },
    fieldEncryptionKey,
  };
});
