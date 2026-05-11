import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FormSurface, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuthorizationService } from '../../common/authorization/authorization.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import {
  CreateFormTemplateDto,
  UpdateFormTemplateVersionDto,
} from './dto/form-template.dto';
import { FieldSchema, FormSchema } from './form-schema-validator.service';

@Injectable()
export class FormTemplatesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  list(user: AuthContext, specialtyId?: string, surface?: FormSurface) {
    const where: Prisma.FormTemplateWhereInput = {
      is_deleted: false,
      surface: surface ?? 'CLINICAL_ENCOUNTER',
      OR: [
        { scope: 'SYSTEM', organization_id: null },
        { scope: 'ORGANIZATION', organization_id: user.organizationId },
      ],
      ...(specialtyId ? { specialty_id: specialtyId } : {}),
    };
    return this.prismaService.db.formTemplate.findMany({
      where,
      orderBy: [{ scope: 'asc' }, { name: 'asc' }],
      include: {
        versions: { orderBy: { version_number: 'desc' } },
      },
    });
  }

  async findOne(id: string, user: AuthContext) {
    const template = await this.prismaService.db.formTemplate.findUnique({
      where: { id },
      include: { versions: { orderBy: { version_number: 'desc' } } },
    });
    this.assertVisible(template, user);
    return template!;
  }

  async create(dto: CreateFormTemplateDto, user: AuthContext) {
    await this.authorization.assertCanManageOrganization(
      user.profileId,
      user.organizationId,
    );

    const specialty = await this.prismaService.db.specialty.findUnique({
      where: { id: dto.specialty_id },
    });
    if (!specialty || specialty.is_deleted) {
      throw new NotFoundException(`Specialty ${dto.specialty_id} not found`);
    }

    let seedSchema: FormSchema = { sections: [] };
    if (dto.clone_from_template_id) {
      const source = await this.prismaService.db.formTemplate.findUnique({
        where: { id: dto.clone_from_template_id },
        include: {
          versions: {
            where: { status: 'PUBLISHED' },
            orderBy: { version_number: 'desc' },
            take: 1,
          },
        },
      });
      this.assertVisible(source, user);
      if (!source!.versions[0]) {
        throw new BadRequestException(
          'Source template has no published version to clone from.',
        );
      }
      seedSchema = source!.versions[0].schema as unknown as FormSchema;
    }

    return this.prismaService.db.formTemplate.create({
      data: {
        name: dto.name,
        code: dto.code,
        description: dto.description,
        scope: 'ORGANIZATION',
        surface: 'CLINICAL_ENCOUNTER',
        specialty_id: dto.specialty_id,
        organization_id: user.organizationId,
        versions: {
          create: {
            version_number: 1,
            status: 'DRAFT',
            schema: seedSchema as unknown as Prisma.InputJsonValue,
          },
        },
      },
      include: { versions: true },
    });
  }

  async createDraftVersion(templateId: string, user: AuthContext) {
    await this.authorization.assertCanManageOrganization(
      user.profileId,
      user.organizationId,
    );
    const template = await this.assertOrgTemplate(templateId, user);
    const last = await this.prismaService.db.formTemplateVersion.findFirst({
      where: { template_id: template.id },
      orderBy: { version_number: 'desc' },
    });
    if (last && last.status === 'DRAFT') {
      throw new BadRequestException(
        'A draft version already exists for this template. Edit or publish it before creating another.',
      );
    }
    return this.prismaService.db.formTemplateVersion.create({
      data: {
        template_id: template.id,
        version_number: (last?.version_number ?? 0) + 1,
        status: 'DRAFT',
        schema: (last?.schema ?? { sections: [] }) as Prisma.InputJsonValue,
      },
    });
  }

  async updateDraftVersion(
    templateId: string,
    versionId: string,
    dto: UpdateFormTemplateVersionDto,
    user: AuthContext,
  ) {
    await this.authorization.assertCanManageOrganization(
      user.profileId,
      user.organizationId,
    );
    const template = await this.assertOrgTemplate(templateId, user);
    const version = await this.prismaService.db.formTemplateVersion.findUnique({
      where: { id: versionId },
    });
    if (!version || version.template_id !== template.id) {
      throw new NotFoundException(`Version ${versionId} not found`);
    }
    if (version.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT versions can be edited.');
    }
    assertSchemaStructure(dto.schema as unknown as FormSchema);
    return this.prismaService.db.formTemplateVersion.update({
      where: { id: versionId },
      data: { schema: dto.schema as unknown as Prisma.InputJsonValue },
    });
  }

  async publishVersion(
    templateId: string,
    versionId: string,
    user: AuthContext,
  ) {
    await this.authorization.assertCanManageOrganization(
      user.profileId,
      user.organizationId,
    );
    const template = await this.assertOrgTemplate(templateId, user);
    const version = await this.prismaService.db.formTemplateVersion.findUnique({
      where: { id: versionId },
    });
    if (!version || version.template_id !== template.id) {
      throw new NotFoundException(`Version ${versionId} not found`);
    }
    if (version.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT versions can be published.');
    }

    const previousPublished =
      await this.prismaService.db.formTemplateVersion.findFirst({
        where: { template_id: template.id, status: 'PUBLISHED' },
        orderBy: { version_number: 'desc' },
      });
    if (previousPublished) {
      const renames = diffFieldCodes(
        previousPublished.schema as unknown as FormSchema,
        version.schema as unknown as FormSchema,
      );
      if (renames.length > 0) {
        throw new BadRequestException({
          message: `Field codes are immutable across versions. Detected renames or removals: ${renames.join(', ')}`,
          fields: { schema: renames },
        });
      }
    }

    return this.prismaService.db.$transaction(async (tx) => {
      if (previousPublished) {
        await tx.formTemplateVersion.update({
          where: { id: previousPublished.id },
          data: { status: 'ARCHIVED' },
        });
      }
      return tx.formTemplateVersion.update({
        where: { id: versionId },
        data: {
          status: 'PUBLISHED',
          published_at: new Date(),
          published_by_id: user.profileId,
        },
      });
    });
  }

  async softDelete(templateId: string, user: AuthContext) {
    await this.authorization.assertCanManageOrganization(
      user.profileId,
      user.organizationId,
    );
    const template = await this.assertOrgTemplate(templateId, user);
    await this.prismaService.db.formTemplate.update({
      where: { id: template.id },
      data: { is_deleted: true, deleted_at: new Date() },
    });
  }

  private assertVisible(
    template: {
      scope: string;
      organization_id: string | null;
      is_deleted: boolean;
    } | null,
    user: AuthContext,
  ): void {
    if (!template || template.is_deleted) {
      throw new NotFoundException('Form template not found');
    }
    if (
      template.scope === 'ORGANIZATION' &&
      template.organization_id !== user.organizationId
    ) {
      throw new NotFoundException('Form template not found');
    }
  }

  private async assertOrgTemplate(templateId: string, user: AuthContext) {
    const template = await this.prismaService.db.formTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template || template.is_deleted) {
      throw new NotFoundException(`Form template ${templateId} not found`);
    }
    if (template.scope === 'SYSTEM') {
      throw new ForbiddenException('System templates cannot be modified.');
    }
    if (template.organization_id !== user.organizationId) {
      throw new NotFoundException(`Form template ${templateId} not found`);
    }
    return template;
  }
}

function assertSchemaStructure(schema: FormSchema): void {
  if (
    !schema ||
    typeof schema !== 'object' ||
    !Array.isArray(schema.sections)
  ) {
    throw new BadRequestException('schema must contain a sections array');
  }
  for (const section of schema.sections) {
    if (
      !section ||
      typeof section.code !== 'string' ||
      !Array.isArray(section.fields)
    ) {
      throw new BadRequestException(
        'each section requires a code and a fields array',
      );
    }
    for (const field of section.fields) {
      assertFieldStructure(field, `${section.code}.${field?.code ?? '?'}`);
    }
  }
}

function assertFieldStructure(field: FieldSchema, path: string): void {
  if (
    !field ||
    typeof field.code !== 'string' ||
    typeof field.type !== 'string'
  ) {
    throw new BadRequestException(`field at ${path} requires code and type`);
  }
  if (field.type === 'REPEATING_GROUP') {
    for (const child of field.fields ?? []) {
      assertFieldStructure(child, `${path}.${child?.code ?? '?'}`);
    }
  }
}

function collectFieldCodes(schema: FormSchema): Set<string> {
  const out = new Set<string>();
  const walk = (fields: FieldSchema[] | undefined, prefix: string) => {
    for (const f of fields ?? []) {
      const key = `${prefix}${f.code}`;
      out.add(key);
      if (f.type === 'REPEATING_GROUP') walk(f.fields, `${key}.`);
    }
  };
  for (const section of schema.sections ?? []) {
    walk(section.fields, `${section.code}.`);
  }
  return out;
}

function diffFieldCodes(prev: FormSchema, next: FormSchema): string[] {
  const before = collectFieldCodes(prev);
  const after = collectFieldCodes(next);
  const removed: string[] = [];
  for (const code of before) {
    if (!after.has(code)) removed.push(`removed:${code}`);
  }
  return removed;
}
