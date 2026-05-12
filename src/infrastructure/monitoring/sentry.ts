import type { Integration } from '@sentry/core';
import * as Sentry from '@sentry/nestjs';

const integrations: Integration[] = [Sentry.prismaIntegration()];

try {
  // Native binary only available on Linux (production). Silently skip on Windows dev.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { nodeProfilingIntegration } = require('@sentry/profiling-node') as {
    nodeProfilingIntegration: () => unknown;
  };
  integrations.push(nodeProfilingIntegration() as Integration);
} catch {
  // profiling native binary not available in this environment
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  enableLogs: true,
  sendDefaultPii: true,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  profileSessionSampleRate: 1.0,
  profileLifecycle: 'trace',
  integrations,
});
