import { registerAs } from '@nestjs/config';
import { parsePositiveInt, requireEnv } from './env.utils.js';

export interface AuthConfig {
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    resetSecret: string;
    accessExpiration: string;
    refreshExpiration: string;
    registrationExpiration: string;
    wsTicketExpiration: string;
  };
  resend: {
    apiKey: string;
    fromEmail: string;
  };
  verificationCodes: {
    otpTtlMinutes: number;
    otpMaxAttempts: number;
    otpBcryptRounds: number;
    resendCooldownSeconds: number;
    resendMaxPerHour: number;
  };
  freeTrialDays: number;
  invitationExpireHours: number;
}

export default registerAs(
  'auth',
  (): AuthConfig => ({
    jwt: {
      accessSecret: requireEnv('JWT_ACCESS_SECRET'),
      refreshSecret: requireEnv('JWT_REFRESH_SECRET'),
      resetSecret: requireEnv('JWT_RESET_SECRET'),
      accessExpiration: process.env.JWT_ACCESS_EXPIRATION ?? '30m',
      refreshExpiration: process.env.JWT_REFRESH_EXPIRATION ?? '7d',
      registrationExpiration: process.env.JWT_REGISTRATION_EXPIRATION ?? '30m',
      wsTicketExpiration: process.env.JWT_WS_TICKET_EXPIRATION ?? '60s',
    },
    resend: {
      apiKey: requireEnv('RESEND_API_KEY'),
      fromEmail: process.env.RESEND_FROM_EMAIL ?? 'noreply@example.com',
    },
    verificationCodes: {
      otpTtlMinutes: parsePositiveInt('OTP_TTL_MINUTES', '15'),
      otpMaxAttempts: parsePositiveInt('OTP_MAX_ATTEMPTS', '5'),
      otpBcryptRounds: parsePositiveInt('OTP_BCRYPT_ROUNDS', '10'),
      resendCooldownSeconds: parsePositiveInt(
        'OTP_RESEND_COOLDOWN_SECONDS',
        '60',
      ),
      resendMaxPerHour: parsePositiveInt('OTP_RESEND_MAX_PER_HOUR', '5'),
    },
    freeTrialDays: parsePositiveInt('FREE_TRIAL_DAYS', '14'),
    invitationExpireHours: parsePositiveInt('INVITATION_EXPIRE_HOURS', '72'),
  }),
);
