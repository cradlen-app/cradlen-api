import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '../../generated/prisma/client.js';
import type { DatabaseConfig } from '../config/database.config.js';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly prisma: PrismaClient;

  constructor(configService: ConfigService) {
    const { url } = configService.get<DatabaseConfig>('database')!;
    const adapter = new PrismaNeon({ connectionString: url });
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
