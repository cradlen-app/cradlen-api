import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

/**
 * Generates per-organization, per-year receipt numbers (`RCP-<year>-<seq>`).
 * Mirrors InvoiceNumberService: an atomic upsert on the (organization, year)
 * sequence row guarantees gap-free, race-safe increments.
 */
@Injectable()
export class ReceiptNumberService {
  constructor(private readonly prismaService: PrismaService) {}

  async generate(organizationId: string): Promise<string> {
    const rows = await this.prismaService.db.$transaction(async (tx) => {
      return tx.$queryRaw<Array<{ last_seq: number; year: number }>>(Prisma.sql`
        INSERT INTO "receipt_sequences" (id, organization_id, year, last_seq, is_deleted, created_at, updated_at)
        VALUES (gen_random_uuid(), ${organizationId}, EXTRACT(YEAR FROM now())::int, 1, false, now(), now())
        ON CONFLICT (organization_id, year)
        DO UPDATE SET last_seq = "receipt_sequences".last_seq + 1, updated_at = now()
        RETURNING last_seq, year
      `);
    });

    const sequence = rows[0];
    if (!sequence) {
      throw new InternalServerErrorException(
        'Failed to generate receipt sequence',
      );
    }
    return `RCP-${sequence.year}-${String(sequence.last_seq).padStart(5, '0')}`;
  }
}
