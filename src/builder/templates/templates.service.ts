import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { HydratableTemplate } from '../renderer/template-renderer.service.js';
import { TemplateCompositionService } from './template-composition.service.js';

/**
 * Read-only DB layer for `form_templates`. Active rows are found via partial
 * unique indexes:
 *   - shells: `(code) WHERE is_active AND NOT is_deleted AND parent_template_id IS NULL`
 *   - extensions: `(parent_template_id, extension_key) WHERE is_active AND NOT is_deleted`
 * Rollback is a pointer flip, never `max(version)`.
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly composer: TemplateCompositionService,
  ) {}

  async findActiveByCode(code: string): Promise<HydratableTemplate> {
    const row = await this.prismaService.db.formTemplate.findFirst({
      where: {
        code,
        is_active: true,
        is_deleted: false,
        parent_template_id: null,
      },
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

  async findActiveExtension(
    parentTemplateId: string,
    extensionKey: string,
  ): Promise<HydratableTemplate> {
    const row = await this.prismaService.db.formTemplate.findFirst({
      where: {
        parent_template_id: parentTemplateId,
        extension_key: extensionKey,
        is_active: true,
        is_deleted: false,
      },
      include: { sections: { include: { fields: true } } },
    });
    if (!row) {
      throw new NotFoundException(
        `No active extension "${extensionKey}" found for parent template ${parentTemplateId}`,
      );
    }
    return row;
  }

  async findActiveComposed(
    code: string,
    extensionKey: string | null,
  ): Promise<HydratableTemplate> {
    const shell = await this.findActiveByCode(code);
    if (!extensionKey) return shell;
    const extension = await this.findActiveExtension(shell.id, extensionKey);
    return this.composer.compose(shell, extension);
  }

  listActive() {
    return this.prismaService.db.formTemplate.findMany({
      where: {
        is_active: true,
        is_deleted: false,
        status: 'PUBLISHED',
        parent_template_id: null,
      },
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
