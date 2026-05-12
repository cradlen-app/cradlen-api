import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { HydratableTemplate } from '../renderer/template-renderer.service.js';

/**
 * Read-only DB layer for `form_templates`. The active row is found via the
 * partial unique index on `(code) WHERE is_active=true AND is_deleted=false`,
 * not by `max(version)` — rollback is just a pointer flip.
 */
@Injectable()
export class TemplatesService {
  constructor(private readonly prismaService: PrismaService) {}

  async findActiveByCode(code: string): Promise<HydratableTemplate> {
    const row = await this.prismaService.db.formTemplate.findFirst({
      where: { code, is_active: true, is_deleted: false },
      include: { sections: { include: { fields: true } } },
    });
    if (!row) {
      throw new NotFoundException(
        `No active form template found for code "${code}"`,
      );
    }
    return row;
  }

  async findVersion(
    code: string,
    version: number,
  ): Promise<HydratableTemplate> {
    const row = await this.prismaService.db.formTemplate.findFirst({
      where: { code, version, is_deleted: false },
      include: { sections: { include: { fields: true } } },
    });
    if (!row) {
      throw new NotFoundException(
        `No form template found for code "${code}" version ${version}`,
      );
    }
    return row;
  }

  listActive() {
    return this.prismaService.db.formTemplate.findMany({
      where: { is_active: true, is_deleted: false, status: 'PUBLISHED' },
      orderBy: [{ scope: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        scope: true,
        version: true,
        specialty_id: true,
        activated_at: true,
      },
    });
  }
}
