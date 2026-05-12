import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { assertVersionMatches } from '@common/decorators/if-match.decorator';
import { ObgynPatientAccessService } from '../patient-access.service';

type SidecarJsonSection =
  | 'gynecological_baseline'
  | 'gynecologic_procedures'
  | 'screening_history'
  | 'medical_chronic_illnesses'
  | 'family_history'
  | 'fertility_history'
  | 'social_history';

@Injectable()
export class ObgynHistoryService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly access: ObgynPatientAccessService,
  ) {}

  async get(patientId: string, user: AuthContext) {
    await this.access.assertPatientInOrg(patientId, user);

    // Lazy-create the sidecar row on first read so subsequent PATCHes have a
    // version to gate against. Without this, the first PATCH would 404 instead
    // of returning a usable form.
    const existing = await this.prismaService.db.patientObgynHistory.findUnique(
      { where: { patient_id: patientId } },
    );
    if (existing) return existing;

    return this.prismaService.db.patientObgynHistory.create({
      data: { patient_id: patientId, updated_by_id: user.profileId },
    });
  }

  async patchSection(
    patientId: string,
    section: SidecarJsonSection,
    value: object,
    ifMatchVersion: number,
    user: AuthContext,
  ) {
    await this.access.assertPatientInOrg(patientId, user);
    const current = await this.get(patientId, user);
    assertVersionMatches(ifMatchVersion, current.version);

    return this.prismaService.db.patientObgynHistory.update({
      where: { id: current.id },
      data: {
        [section]: value as Prisma.InputJsonValue,
        version: { increment: 1 },
        updated_by_id: user.profileId,
      },
    });
  }

  async patchHusbandName(
    patientId: string,
    husbandName: string | null | undefined,
    ifMatchVersion: number,
    user: AuthContext,
  ) {
    await this.access.assertPatientInOrg(patientId, user);
    const current = await this.get(patientId, user);
    assertVersionMatches(ifMatchVersion, current.version);

    return this.prismaService.db.patientObgynHistory.update({
      where: { id: current.id },
      data: {
        husband_name: husbandName ?? null,
        version: { increment: 1 },
        updated_by_id: user.profileId,
      },
    });
  }
}
