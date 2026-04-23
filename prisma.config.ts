import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

const nodeEnv = process.env.NODE_ENV ?? 'development';
const envFile = process.env.ENV_FILE ?? `.env.${nodeEnv}`;

config({ path: '.env' });
config({ path: envFile, override: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'],
  },
});
