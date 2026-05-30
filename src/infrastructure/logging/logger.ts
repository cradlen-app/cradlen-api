import pino from 'pino';
import pretty from 'pino-pretty';
import * as Sentry from '@sentry/nestjs';
import { Writable } from 'stream';

const isDev = process.env.NODE_ENV !== 'production';

type SentryLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

function pinoLevelToSentry(level: number): SentryLevel {
  if (level >= 60) return 'fatal';
  if (level >= 50) return 'error';
  if (level >= 40) return 'warn';
  if (level >= 30) return 'info';
  if (level >= 20) return 'debug';
  return 'trace';
}

const sentryWritable = new Writable({
  write(chunk: Buffer, _encoding: string, callback: () => void) {
    try {
      const log = JSON.parse(chunk.toString()) as Record<string, unknown>;
      const { level, msg, ...rest } = log;
      const attrs = { ...rest };
      delete (attrs as Record<string, unknown>)['pid'];
      delete (attrs as Record<string, unknown>)['hostname'];
      delete (attrs as Record<string, unknown>)['time'];
      Sentry.logger[pinoLevelToSentry(level as number)](String(msg), attrs);
    } catch {
      // ignore malformed lines (e.g. pino-pretty decorations)
    }
    callback();
  },
});

const stdoutStream = isDev
  ? pretty({
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    })
  : process.stdout;

// Redaction targets cover request bodies, headers, and known token-bearing
// fields. Pino removes the value before serialization, so secrets never
// reach stdout, Sentry, or any downstream stream — even at trace level.
export const REDACTION_PATHS = [
  // Inbound credentials and one-time codes (Nest request lifecycle).
  'req.body.password',
  'req.body.confirm_password',
  'req.body.new_password',
  'req.body.code',
  'req.body.refresh_token',
  'req.body.reset_token',
  'req.body.signup_token',
  'req.body.selection_token',
  'req.headers.authorization',
  'req.headers.cookie',
  // Server-side echoes of the same secrets (defensive — many handlers
  // log dto objects directly during debugging).
  'password',
  'confirm_password',
  'new_password',
  'password_hashed',
  'token_hash',
  'code_hash',
  'access_token',
  'refresh_token',
  'reset_token',
  'signup_token',
  'selection_token',
];

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: { paths: REDACTION_PATHS, censor: '[REDACTED]' },
  },
  pino.multistream([{ stream: stdoutStream }, { stream: sentryWritable }]),
);
