import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { assertVersionMatches } from '@common/decorators/if-match.decorator';
import { ObgynPatientAccessService } from '../patient-access.service';

type EncounterSection =
  | 'general_findings'
  | 'cardiovascular_findings'
  | 'respiratory_findings'
  | 'menstrual_findings'
  | 'abdominal_findings'
  | 'pelvic_findings'
  | 'breast_findings'
  | 'extremities_findings'
  | 'neurological_findings'
  | 'skin_findings';

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

    // Lazy-create on first read; matches PatientObgynHistory pattern.
    return this.prismaService.db.visitObgynEncounter.create({
      data: { visit_id: visitId, updated_by_id: user.profileId },
    });
  }

  async patchSection(
    visitId: string,
    section: EncounterSection,
    value: object,
    ifMatchVersion: number,
    user: AuthContext,
  ) {
    await this.access.assertVisitInOrg(visitId, user);
    const current = await this.get(visitId, user);
    assertVersionMatches(ifMatchVersion, current.version);

    return this.prismaService.db.visitObgynEncounter.update({
      where: { id: current.id },
      data: {
        [section]: value as Prisma.InputJsonValue,
        version: { increment: 1 },
        updated_by_id: user.profileId,
      },
    });
  }
}
