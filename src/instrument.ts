import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { PrismaInstrumentation } from '@prisma/instrumentation';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  enableLogs: true,
  sendDefaultPii: true,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  profileSessionSampleRate: 1.0,
  profileLifecycle: 'trace',
  integrations: [
    nodeProfilingIntegration(),
    // @ts-expect-error — PrismaInstrumentation is compatible at runtime but lacks the Sentry integration name property
    new PrismaInstrumentation(),
  ],
});
