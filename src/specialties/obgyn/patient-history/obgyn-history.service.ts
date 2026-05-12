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
import { UpdateObgynHistoryDto } from './dto/obgyn-history.dto';

const PATCHABLE_FIELDS = [
  'husband_name',
  'gynecological_baseline',
  'gynecologic_procedures',
  'screening_history',
  'medical_chronic_illnesses',
  'family_history',
  'fertility_history',
  'social_history',
] as const;

type PatchableField = (typeof PATCHABLE_FIELDS)[number];

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

  /**
   * Bulk PATCH — accept any subset of the OB/GYN history sections in one
   * request. The doctor's "Save All" button hits this once with the whole
   * tab payload.
   *
   * Optimistic concurrency: client must echo the row's current `version` via
   * `If-Match`. Inside a single Prisma transaction we snapshot the prior row
   * to `patient_obgyn_history_revisions`, then update the changed columns
   * and bump `version`. One row update, one revision row, one event.
   */
  async patch(
    patientId: string,
    dto: UpdateObgynHistoryDto,
    ifMatchVersion: number,
    user: AuthContext,
  ) {
    await this.access.assertPatientInOrg(patientId, user);
    const current = await this.get(patientId, user);
    assertVersionMatches(ifMatchVersion, current.version);

    const data: Prisma.PatientObgynHistoryUncheckedUpdateInput = {
      version: { increment: 1 },
      updated_by_id: user.profileId,
    };
    const changed: PatchableField[] = [];

    for (const field of PATCHABLE_FIELDS) {
      if (!(field in dto)) continue;
      const value = (dto as Record<string, unknown>)[field];
      if (field === 'husband_name') {
        data.husband_name = (value as string | null | undefined) ?? null;
      } else {
        // All JSON sections — undefined skipped, null clears the field.
        (data as Record<string, unknown>)[field] =
          value as Prisma.InputJsonValue;
      }
      changed.push(field);
    }

    if (changed.length === 0) return current;

    const updated = await this.prismaService.db.$transaction(async (tx) => {
      await tx.patientObgynHistoryRevision.create({
        data: buildRevision(current, changed, user.profileId),
      });
      return tx.patientObgynHistory.update({
        where: { id: current.id },
        data,
      });
    });

    this.eventBus.publish<PatientHistoryUpdatedEvent>(
      CLINICAL_EVENTS.patient.historyUpdated,
      {
        patient_id: patientId,
        specialty: 'OBGYN',
        section_codes: changed,
        updated_by_id: user.profileId,
        version: updated.version,
      },
    );

    return updated;
  }
}
