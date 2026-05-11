import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

type ResolveArgs = {
  profileId: string;
  organizationId: string;
  specialtyId?: string;
};

@Injectable()
export class FormTemplateResolverService {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Resolution order (first PUBLISHED hit wins):
   *   1. ORG template for the profile's specialty (child if hierarchical)
   *   2. ORG template for the parent specialty
   *   3. SYSTEM template for the profile's specialty
   *   4. SYSTEM template for the parent specialty
   */
  async resolveForEncounter(args: ResolveArgs) {
    const specialtyId =
      args.specialtyId ?? (await this.primarySpecialtyId(args.profileId));
    if (!specialtyId) {
      throw new NotFoundException(
        'No specialty associated with this profile — cannot resolve a clinical encounter template.',
      );
    }

    const specialty = await this.prismaService.db.specialty.findUnique({
      where: { id: specialtyId },
      select: { id: true, parent_specialty_id: true },
    });
    if (!specialty) {
      throw new NotFoundException(`Specialty ${specialtyId} not found`);
    }

    const chain: Array<{
      scope: 'SYSTEM' | 'ORGANIZATION';
      specialtyId: string;
    }> = [{ scope: 'ORGANIZATION', specialtyId: specialty.id }];
    if (specialty.parent_specialty_id) {
      chain.push({
        scope: 'ORGANIZATION',
        specialtyId: specialty.parent_specialty_id,
      });
    }
    chain.push({ scope: 'SYSTEM', specialtyId: specialty.id });
    if (specialty.parent_specialty_id) {
      chain.push({
        scope: 'SYSTEM',
        specialtyId: specialty.parent_specialty_id,
      });
    }

    for (const step of chain) {
      const where: Prisma.FormTemplateWhereInput = {
        scope: step.scope,
        specialty_id: step.specialtyId,
        surface: 'CLINICAL_ENCOUNTER',
        is_deleted: false,
        organization_id:
          step.scope === 'ORGANIZATION' ? args.organizationId : null,
        versions: { some: { status: 'PUBLISHED' } },
      };
      const template = await this.prismaService.db.formTemplate.findFirst({
        where,
        include: {
          versions: {
            where: { status: 'PUBLISHED' },
            orderBy: { version_number: 'desc' },
            take: 1,
          },
        },
      });
      if (template && template.versions[0]) {
        return template.versions[0];
      }
    }

    throw new NotFoundException(
      'No published clinical encounter template found for this profile/specialty.',
    );
  }

  private async primarySpecialtyId(profileId: string): Promise<string | null> {
    const link = await this.prismaService.db.profileSpecialty.findFirst({
      where: { profile: { id: profileId, is_deleted: false } },
      orderBy: { created_at: 'asc' },
    });
    return link?.specialty_id ?? null;
  }
}
