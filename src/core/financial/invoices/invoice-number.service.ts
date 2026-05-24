import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

@Injectable()
export class InvoiceNumberService {
  constructor(private readonly prismaService: PrismaService) {}

  async generate(organizationId: string): Promise<string> {
    const year = new Date().getFullYear();

    const sequence = await this.prismaService.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "invoice_sequences" (id, organization_id, year, last_seq, created_at, updated_at)
        VALUES (gen_random_uuid(), ${organizationId}, ${year}, 1, now(), now())
        ON CONFLICT (organization_id, year)
        DO UPDATE SET last_seq = "invoice_sequences".last_seq + 1, updated_at = now()
      `);
      return tx.invoiceSequence.findUnique({
        where: { organization_id_year: { organization_id: organizationId, year } },
      });
    });

    return `INV-${year}-${String(sequence!.last_seq).padStart(5, '0')}`;
  }
}
