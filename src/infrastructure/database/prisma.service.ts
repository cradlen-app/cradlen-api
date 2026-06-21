import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import databaseConfig from '@config/database.config.js';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly prisma: PrismaClient;

  constructor(
    @Inject(databaseConfig.KEY)
    dbConfig: ConfigType<typeof databaseConfig>,
  ) {
    // Production/dev run on Neon (serverless driver). CI/test can set
    // DB_ADAPTER=pg to talk to a plain Postgres via node-postgres — an
    // in-runner database with ~0 latency and full isolation, no Neon proxy.
    // Both implement the same Prisma driver-adapter contract.
    const adapter =
      process.env.DB_ADAPTER === 'pg'
        ? new PrismaPg({ connectionString: dbConfig.url })
        : new PrismaNeon({ connectionString: dbConfig.url });
    this.prisma = new PrismaClient({ adapter });
  }

  get db(): PrismaClient {
    return this.prisma;
  }

  async onModuleInit() {
    await this.prisma.$connect();
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
