import { registerAs } from '@nestjs/config';

function parsePositiveInt(name: string, fallback: string): number {
  const raw = process.env[name] ?? fallback;
  const value = parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export interface AuthConfig {
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    resetSecret: string;
    accessExpiration: string;
    refreshExpiration: string;
    registrationExpiration: string;
  };
  resend: {
    apiKey: string;
    fromEmail: string;
  };
  freeTrialDays: number;
  invitationExpireHours: number;
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
      resetSecret:
        process.env.JWT_RESET_SECRET ??
        (() => {
          throw new Error('JWT_RESET_SECRET is not set');
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
    freeTrialDays: parsePositiveInt('FREE_TRIAL_DAYS', '14'),
    invitationExpireHours: parsePositiveInt('INVITATION_EXPIRE_HOURS', '72'),
  }),
);
