import { registerAs } from '@nestjs/config';
import { requireEnv } from './env.utils.js';

export interface DatabaseConfig {
  url: string;
}

export default registerAs(
  'database',
  (): DatabaseConfig => ({
    url: requireEnv('DATABASE_URL'),
  }),
);
