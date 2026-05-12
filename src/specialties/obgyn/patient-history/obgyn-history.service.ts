import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { assertVersionMatches } from '@common/decorators/if-match.decorator';
import { EventBus } from '@infrastructure/messaging/event-bus';
import {
  CLINICAL_EVENTS,
  type PatientHistoryUpdatedEvent,
} from '@core/clinical/events/events.public';
import { ObgynPatientAccessService } from '../patient-access.service';
import { buildRevision } from '../revisions.helper';

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
    private readonly eventBus: EventBus,
  ) {}

  async get(patientId: string, user: AuthContext) {
    await this.access.assertPatientInOrg(patientId, user);

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

    const updated = await this.prismaService.db.$transaction(async (tx) => {
      await tx.patientObgynHistoryRevision.create({
        data: buildRevision(current, [section], user.profileId),
      });
      return tx.patientObgynHistory.update({
        where: { id: current.id },
        data: {
          [section]: value as Prisma.InputJsonValue,
          version: { increment: 1 },
          updated_by_id: user.profileId,
        },
      });
    });

    this.eventBus.publish<PatientHistoryUpdatedEvent>(
      CLINICAL_EVENTS.patient.historyUpdated,
      {
        patient_id: patientId,
        specialty: 'OBGYN',
        section_code: section,
        updated_by_id: user.profileId,
        version: updated.version,
      },
    );

    return updated;
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

    const updated = await this.prismaService.db.$transaction(async (tx) => {
      await tx.patientObgynHistoryRevision.create({
        data: buildRevision(current, ['husband_name'], user.profileId),
      });
      return tx.patientObgynHistory.update({
        where: { id: current.id },
        data: {
          husband_name: husbandName ?? null,
          version: { increment: 1 },
          updated_by_id: user.profileId,
        },
      });
    });

    this.eventBus.publish<PatientHistoryUpdatedEvent>(
      CLINICAL_EVENTS.patient.historyUpdated,
      {
        patient_id: patientId,
        specialty: 'OBGYN',
        section_code: 'husband_name',
        updated_by_id: user.profileId,
        version: updated.version,
      },
    );

    return updated;
  }
}
