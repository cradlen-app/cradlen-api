import { registerAs } from '@nestjs/config';

export interface AppConfig {
  name: string;
  env: string;
  port: number;
  appUrl: string;
  versioning: {
    enabled: boolean;
    prefix: string;
    defaultVersion: string;
  };
  localisation: {
    defaultLocale: string;
    supportedLocales: string[];
    fallbackLocale: string;
  };
  cors: {
    origins: string | string[];
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
    port: parseInt(process.env.PORT ?? '3000', 10),
    appUrl:
      process.env.APP_URL ??
      (() => {
        throw new Error('APP_URL is not set');
      })(),
    versioning: {
      enabled: true,
      prefix: 'v',
      defaultVersion: process.env.API_DEFAULT_VERSION ?? '1',
    },
    localisation: {
      defaultLocale: process.env.DEFAULT_LOCALE ?? 'en',
      supportedLocales: (process.env.SUPPORTED_LOCALES ?? 'en,ar').split(','),
      fallbackLocale: process.env.FALLBACK_LOCALE ?? 'en',
    },
    cors: {
      origins: process.env.CORS_ORIGINS?.split(',') ?? [],
    },
    throttle: {
      ttl: parseInt(process.env.THROTTLE_TTL ?? '60000', 10),
      limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
    },
  }),
);
