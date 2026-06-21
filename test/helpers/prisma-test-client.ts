import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

let client: PrismaClient | null = null;

export function getTestPrisma(): PrismaClient {
  if (!client) {
    const connectionString = process.env.DATABASE_URL!;
    // CI uses a plain Postgres (DB_ADAPTER=pg); local/dev uses Neon.
    const adapter =
      process.env.DB_ADAPTER === 'pg'
        ? new PrismaPg({ connectionString })
        : new PrismaNeon({ connectionString });
    client = new PrismaClient({ adapter } as ConstructorParameters<
      typeof PrismaClient
    >[0]);
  }
  return client;
}

export async function disconnectTestPrisma(): Promise<void> {
  if (client) {
    await (
      client as unknown as { $disconnect: () => Promise<void> }
    ).$disconnect();
    client = null;
  }
}
