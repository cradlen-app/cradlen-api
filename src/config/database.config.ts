import { registerAs } from '@nestjs/config';
import { requireEnv } from './env.utils.js';

export interface DatabaseConfig {
  url: string;
  /**
   * Row-Level-Security enforcement toggle. OFF by default — the RLS
   * session-context plumbing is inert until this is explicitly enabled, so
   * policies can be rolled out table-by-table and verified against the pooler
   * before enforcement goes live. See rls-context.interceptor.ts.
   */
  rlsEnabled: boolean;
}

export default registerAs(
  'database',
  (): DatabaseConfig => ({
    url: requireEnv('DATABASE_URL'),
    rlsEnabled: process.env.RLS_ENABLED === 'true',
  }),
);
