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
import complianceConfig from '@config/compliance.config.js';
import { FieldCrypto } from '@common/crypto/field-crypto.util.js';
import { getRlsContext } from './rls-context.js';
import { nationalIdEncryptionExtension } from './national-id.extension.js';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly prisma: PrismaClient;

  constructor(
    @Inject(databaseConfig.KEY)
    dbConfig: ConfigType<typeof databaseConfig>,
    @Inject(complianceConfig.KEY)
    compliance: ConfigType<typeof complianceConfig>,
  ) {
    // Production/dev run on Neon (serverless driver). CI/test can set
    // DB_ADAPTER=pg to talk to a plain Postgres via node-postgres — an
    // in-runner database with ~0 latency and full isolation, no Neon proxy.
    // Both implement the same Prisma driver-adapter contract.
    const adapter =
      process.env.DB_ADAPTER === 'pg'
        ? new PrismaPg({ connectionString: dbConfig.url })
        : new PrismaNeon({ connectionString: dbConfig.url });
    const base = new PrismaClient({ adapter });

    // Transparent Patient.national_id encryption when a key is configured.
    const key = compliance.fieldEncryptionKey;
    this.prisma = key
      ? (base.$extends(
          nationalIdEncryptionExtension(new FieldCrypto(key)),
        ) as unknown as PrismaClient)
      : base;
  }

  /**
   * The client for queries. Under RLS (enabled + inside a request), returns the
   * request's transaction proxy so every query runs on the connection where
   * `set_config('app.*', …)` was applied. Otherwise — the default, and always
   * when RLS is off — returns the base client unchanged.
   */
  get db(): PrismaClient {
    return getRlsContext()?.tx ?? this.prisma;
  }

  /** The raw pooled client, bypassing any request RLS transaction. Used to open
   * the per-request RLS transaction itself, and for connection lifecycle. */
  get baseClient(): PrismaClient {
    return this.prisma;
  }

  async onModuleInit() {
    await this.prisma.$connect();
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
