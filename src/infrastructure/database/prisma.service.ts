import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';
import databaseConfig from '@config/database.config.js';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly prisma: PrismaClient;

  constructor(
    @Inject(databaseConfig.KEY)
    dbConfig: ConfigType<typeof databaseConfig>,
  ) {
    const adapter = new PrismaNeon({ connectionString: dbConfig.url });
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
