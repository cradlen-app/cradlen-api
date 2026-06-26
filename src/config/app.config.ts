import { registerAs } from '@nestjs/config';
import { parseList, parsePositiveInt, requireEnv } from './env.utils.js';

export interface AppConfig {
  name: string;
  env: string;
  port: number;
  appUrl: string;
  /** Origin of the cradlen-admin dashboard; used to build admin invite links. */
  adminAppUrl: string;
  versioning: {
    prefix: string;
    defaultVersion: string;
  };
  localisation: {
    defaultLocale: string;
    supportedLocales: string[];
    fallbackLocale: string;
  };
  cors: {
    origins: string[];
  };
  throttle: {
    ttl: number;
    limit: number;
  };
}

export default registerAs(
  'app',
  (): AppConfig => ({
    name: process.env.APP_NAME ?? 'cradlen-api',
    env: process.env.NODE_ENV ?? 'development',
    port: parsePositiveInt('PORT', '3000'),
    appUrl: requireEnv('APP_URL'),
    adminAppUrl: process.env.ADMIN_APP_URL ?? 'http://localhost:3100',
    versioning: {
      prefix: 'v',
      defaultVersion: process.env.API_DEFAULT_VERSION ?? '1',
    },
    localisation: {
      defaultLocale: process.env.DEFAULT_LOCALE ?? 'en',
      supportedLocales: parseList(process.env.SUPPORTED_LOCALES, ['en', 'ar']),
      fallbackLocale: process.env.FALLBACK_LOCALE ?? 'en',
    },
    cors: {
      origins: parseList(process.env.CORS_ORIGINS, []),
    },
    throttle: {
      ttl: parsePositiveInt('THROTTLE_TTL', '60000'),
      limit: parsePositiveInt('THROTTLE_LIMIT', '100'),
    },
  }),
);
