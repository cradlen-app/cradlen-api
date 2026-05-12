import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { assertVersionMatches } from '@common/decorators/if-match.decorator';
import { ObgynPatientAccessService } from '../patient-access.service';
import { buildRevision } from '../revisions.helper';
import { UpdateObgynEncounterDto } from './dto/obgyn-encounter.dto';

const ENCOUNTER_SECTIONS = [
  'general_findings',
  'cardiovascular_findings',
  'respiratory_findings',
  'menstrual_findings',
  'abdominal_findings',
  'pelvic_findings',
  'breast_findings',
  'extremities_findings',
  'neurological_findings',
  'skin_findings',
] as const;

type EncounterSection = (typeof ENCOUNTER_SECTIONS)[number];

@Injectable()
export class ObgynEncounterService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly access: ObgynPatientAccessService,
  ) {}

  async get(visitId: string, user: AuthContext) {
    await this.access.assertVisitInOrg(visitId, user);

    const existing = await this.prismaService.db.visitObgynEncounter.findUnique(
      { where: { visit_id: visitId } },
    );
    if (existing) return existing;

    return this.prismaService.db.visitObgynEncounter.create({
      data: { visit_id: visitId, updated_by_id: user.profileId },
    });
  }

  /**
   * Bulk PATCH — save the entire examination tab in one request. Unsent
   * sections are left untouched. Inside a single transaction we snapshot
   * the prior row, update the changed columns, and bump `version`.
   */
  async patch(
    visitId: string,
    dto: UpdateObgynEncounterDto,
    ifMatchVersion: number,
    user: AuthContext,
  ) {
    await this.access.assertVisitInOrg(visitId, user);
    const current = await this.get(visitId, user);
    assertVersionMatches(ifMatchVersion, current.version);

    const data: Prisma.VisitObgynEncounterUncheckedUpdateInput = {
      version: { increment: 1 },
      updated_by_id: user.profileId,
    };
    const changed: EncounterSection[] = [];

    for (const section of ENCOUNTER_SECTIONS) {
      if (!(section in dto)) continue;
      const value = (dto as Record<string, unknown>)[section];
      (data as Record<string, unknown>)[section] =
        value as Prisma.InputJsonValue;
      changed.push(section);
    }

    if (changed.length === 0) return current;

    return this.prismaService.db.$transaction(async (tx) => {
      await tx.visitObgynEncounterRevision.create({
        data: buildRevision(current, changed, user.profileId),
      });
      return tx.visitObgynEncounter.update({
        where: { id: current.id },
        data,
      });
    });
  }
}
