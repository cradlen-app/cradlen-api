import { registerAs } from '@nestjs/config';

export interface AuthConfig {
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessExpiration: string;
    refreshExpiration: string;
    registrationExpiration: string;
  };
  resend: {
    apiKey: string;
    fromEmail: string;
  };
  freeTrialDays: number;
}

export default registerAs(
  'auth',
  (): AuthConfig => ({
    jwt: {
      accessSecret:
        process.env.JWT_ACCESS_SECRET ??
        (() => {
          throw new Error('JWT_ACCESS_SECRET is not set');
        })(),
      refreshSecret:
        process.env.JWT_REFRESH_SECRET ??
        (() => {
          throw new Error('JWT_REFRESH_SECRET is not set');
        })(),
      accessExpiration: process.env.JWT_ACCESS_EXPIRATION ?? '15m',
      refreshExpiration: process.env.JWT_REFRESH_EXPIRATION ?? '7d',
      registrationExpiration: process.env.JWT_REGISTRATION_EXPIRATION ?? '30m',
    },
    resend: {
      apiKey:
        process.env.RESEND_API_KEY ??
        (() => {
          throw new Error('RESEND_API_KEY is not set');
        })(),
      fromEmail: process.env.RESEND_FROM_EMAIL ?? 'noreply@example.com',
    },
    freeTrialDays: parseInt(process.env.FREE_TRIAL_DAYS ?? '14', 10),
  }),
);
