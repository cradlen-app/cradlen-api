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
      const { level, msg, pid: _pid, hostname: _hostname, time: _time, ...attrs } = log;
      Sentry.logger[pinoLevelToSentry(level as number)](String(msg), attrs);
    } catch {
      // ignore malformed lines (e.g. pino-pretty decorations)
    }
    callback();
  },
});

const stdoutStream = isDev
  ? pretty({ colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' })
  : process.stdout;

export const logger = pino(
  { level: process.env.LOG_LEVEL ?? 'info' },
  pino.multistream([
    { stream: stdoutStream },
    { stream: sentryWritable },
  ]),
);
