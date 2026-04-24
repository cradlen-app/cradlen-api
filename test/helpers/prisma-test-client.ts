import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';

let client: PrismaClient | null = null;

export function getTestPrisma(): PrismaClient {
  if (!client) {
    const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
    client = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  }
  return client;
}

export async function disconnectTestPrisma(): Promise<void> {
  if (client) {
    await (client as unknown as { $disconnect: () => Promise<void> }).$disconnect();
    client = null;
  }
}
