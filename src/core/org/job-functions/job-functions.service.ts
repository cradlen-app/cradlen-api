import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

@Injectable()
export class JobFunctionsService {
  constructor(private readonly prismaService: PrismaService) {}

  findLookup() {
    return this.prismaService.db.jobFunction.findMany({
      select: { code: true, name: true, is_clinical: true },
      orderBy: { name: 'asc' },
    });
  }
}
