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
import {
  AllergyRowDto,
  ContraceptiveRowDto,
  MedicationRowDto,
  NonGynSurgeryRowDto,
  PregnancyRowDto,
  UpdateObgynHistoryDto,
} from './dto/obgyn-history.dto';

const SINGLETON_JSON_FIELDS = [
  'gynecological_baseline',
  'gynecologic_procedures',
  'screening_history',
  'obstetric_summary',
  'medical_chronic_illnesses',
  'family_history',
  'fertility_history',
  'social_history',
  'menopause_history',
] as const;

type SingletonJsonField = (typeof SINGLETON_JSON_FIELDS)[number];

const LIVE_BIRTH_OUTCOMES = ['LIVE_BIRTH'];
const ABORTION_LIKE_OUTCOMES = ['MISCARRIAGE', 'ABORTION', 'ECTOPIC'];

@Injectable()
export class ObgynHistoryService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly access: ObgynPatientAccessService,
    private readonly eventBus: EventBus,
  ) {}

  async get(patientId: string, user: AuthContext) {
    await this.access.assertPatientInOrg(patientId, user);
    const singleton = await this.loadOrCreateSingleton(
      this.prismaService.db,
      patientId,
      user.profileId,
    );
    return this.composeEnvelope(this.prismaService.db, singleton);
  }

  /**
   * Bulk PATCH — accept the entire OB/GYN history surface in one request.
   *
   * Singleton JSON columns + all five child collections (pregnancies,
   * contraceptives, non_gyn_surgeries, medications, allergies) are diffed
   * and written atomically. Child arrays use id-keyed diff semantics:
   * present id → update; missing id → create; live id absent from body →
   * soft-delete. A field absent from the body leaves that collection
   * untouched; sending it as `[]` clears the collection.
   *
   * Optimistic concurrency: client must echo the singleton row's current
   * `version` via `If-Match`. Inside one transaction we snapshot the prior
   * full state (singleton + all child rows) to
   * `patient_obgyn_history_revisions`, apply the diff, then bump `version`.
   * One PATCH = one revision row = one event.
   */
  async patch(
    patientId: string,
    dto: UpdateObgynHistoryDto,
    ifMatchVersion: number,
    user: AuthContext,
  ) {
    await this.access.assertPatientInOrg(patientId, user);

    return this.prismaService.db.$transaction(async (tx) => {
      const current = await this.loadOrCreateSingleton(
        tx,
        patientId,
        user.profileId,
      );
      assertVersionMatches(ifMatchVersion, current.version);

      const priorChildren = await this.loadChildren(tx, patientId);
      const changedSections: string[] = [];

      // ----- Singleton field updates (JSON columns) -----
      const data: Prisma.PatientObgynHistoryUncheckedUpdateInput = {
        updated_by_id: user.profileId,
      };
      for (const field of SINGLETON_JSON_FIELDS) {
        if (!(field in dto)) continue;
        const value = (dto as Record<string, unknown>)[field];
        (data as Record<string, unknown>)[field] =
          value as Prisma.InputJsonValue;
        changedSections.push(field);
      }

      if (dto.blood_group_rh !== undefined) {
        data.blood_group_rh = dto.blood_group_rh;
        changedSections.push('blood_group_rh');
      }

      // ----- Child collection diffs -----
      if (dto.pregnancies !== undefined) {
        await this.diffPregnancies(
          tx,
          patientId,
          priorChildren.pregnancies,
          dto.pregnancies,
          user.profileId,
        );
        changedSections.push('pregnancies');
      }
      if (dto.contraceptives !== undefined) {
        await this.diffContraceptives(
          tx,
          patientId,
          priorChildren.contraceptives,
          dto.contraceptives,
          user.profileId,
        );
        changedSections.push('contraceptives');
      }
      if (dto.non_gyn_surgeries !== undefined) {
        await this.diffNonGynSurgeries(
          tx,
          patientId,
          priorChildren.non_gyn_surgeries,
          dto.non_gyn_surgeries,
          user.profileId,
        );
        changedSections.push('non_gyn_surgeries');
      }
      if (dto.medications !== undefined) {
        await this.diffMedications(
          tx,
          patientId,
          priorChildren.medications,
          dto.medications,
          user.profileId,
        );
        changedSections.push('medications');
      }
      if (dto.allergies !== undefined) {
        await this.diffAllergies(
          tx,
          patientId,
          priorChildren.allergies,
          dto.allergies,
          user.profileId,
        );
        changedSections.push('allergies');
      }

      // If pregnancies were touched but user did NOT supply obstetric_summary,
      // recompute G/P/A from the resulting pregnancy rows so the cached
      // summary stays in sync with the source of truth.
      const pregnanciesTouched = dto.pregnancies !== undefined;
      const summarySupplied = dto.obstetric_summary !== undefined;
      if (pregnanciesTouched && !summarySupplied) {
        const recomputed = await this.recomputeObstetricSummary(tx, patientId);
        data.obstetric_summary = recomputed as unknown as Prisma.InputJsonValue;
        if (!changedSections.includes('obstetric_summary')) {
          changedSections.push('obstetric_summary');
        }
      }

      if (changedSections.length === 0) {
        return this.composeEnvelope(tx, current);
      }

      const now = new Date().toISOString();
      const existingTimestamps = (current.section_timestamps ?? {}) as Record<string, string>;
      const updatedTimestamps = { ...existingTimestamps };
      for (const section of changedSections) {
        updatedTimestamps[section] = now;
      }
      data.section_timestamps = updatedTimestamps;

      // Snapshot the full prior state (singleton + all child arrays) before
      // mutating the singleton. The revision's `version` field is the prior
      // version — buildRevision handles that.
      const priorSnapshot = {
        ...current,
        ...priorChildren,
      };
      await tx.patientObgynHistoryRevision.create({
        data: buildRevision(priorSnapshot, changedSections, user.profileId),
      });

      data.version = { increment: 1 };
      const updated = await tx.patientObgynHistory.update({
        where: { id: current.id },
        data,
      });

      this.eventBus.publish<PatientHistoryUpdatedEvent>(
        CLINICAL_EVENTS.patient.historyUpdated,
        {
          patient_id: patientId,
          specialty: 'OBGYN',
          section_codes: changedSections,
          updated_by_id: user.profileId,
          version: updated.version,
        },
      );

      return this.composeEnvelope(tx, updated);
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async loadOrCreateSingleton(
    tx: Prisma.TransactionClient | typeof this.prismaService.db,
    patientId: string,
    profileId: string,
  ) {
    const existing = await tx.patientObgynHistory.findUnique({
      where: { patient_id: patientId },
    });
    if (existing) return existing;
    return tx.patientObgynHistory.create({
      data: { patient_id: patientId, updated_by_id: profileId },
    });
  }

  private async loadChildren(
    tx: Prisma.TransactionClient | typeof this.prismaService.db,
    patientId: string,
  ) {
    const where = { patient_id: patientId, is_deleted: false };
    const [
      pregnancies,
      contraceptives,
      non_gyn_surgeries,
      medications,
      allergies,
    ] = await Promise.all([
      tx.patientPregnancyHistory.findMany({
        where,
        orderBy: [{ birth_date: 'desc' }, { created_at: 'desc' }],
      }),
      tx.patientContraceptiveHistory.findMany({
        where,
        orderBy: { created_at: 'desc' },
      }),
      tx.patientNonGynSurgery.findMany({
        where,
        orderBy: [{ surgery_date: 'desc' }, { created_at: 'desc' }],
      }),
      tx.patientMedication.findMany({
        where,
        orderBy: [
          { is_ongoing: 'desc' },
          { from_date: 'desc' },
          { created_at: 'desc' },
        ],
      }),
      tx.patientAllergy.findMany({ where, orderBy: { created_at: 'desc' } }),
    ]);
    return {
      pregnancies,
      contraceptives,
      non_gyn_surgeries,
      medications,
      allergies,
    };
  }

  private async composeEnvelope(
    tx: Prisma.TransactionClient | typeof this.prismaService.db,
    singleton: { patient_id: string },
  ) {
    const children = await this.loadChildren(tx, singleton.patient_id);
    return { ...singleton, ...children };
  }

  // ---- Child diff helpers (id-keyed: upsert / create / soft-delete) -------

  private splitDiff<T extends { id?: string }>(
    rows: T[],
    liveIds: Set<string>,
  ) {
    const toUpdate: T[] = [];
    const toCreate: T[] = [];
    const keptIds = new Set<string>();
    for (const row of rows) {
      if (row.id && liveIds.has(row.id)) {
        toUpdate.push(row);
        keptIds.add(row.id);
      } else {
        toCreate.push(row);
      }
    }
    const toDelete: string[] = [];
    for (const id of liveIds) {
      if (!keptIds.has(id)) toDelete.push(id);
    }
    return { toUpdate, toCreate, toDelete };
  }

  private async diffPregnancies(
    tx: Prisma.TransactionClient,
    patientId: string,
    prior: Array<{ id: string }>,
    rows: PregnancyRowDto[],
    profileId: string,
  ) {
    const liveIds = new Set(prior.map((p) => p.id));
    const { toUpdate, toCreate, toDelete } = this.splitDiff(rows, liveIds);
    for (const row of toUpdate) {
      await tx.patientPregnancyHistory.update({
        where: { id: row.id! },
        data: {
          ...(row.birth_date !== undefined && {
            birth_date: row.birth_date ? new Date(row.birth_date) : null,
          }),
          ...(row.outcome !== undefined && { outcome: row.outcome }),
          ...(row.mode_of_delivery !== undefined && {
            mode_of_delivery: row.mode_of_delivery,
          }),
          ...(row.gestational_age_weeks !== undefined && {
            gestational_age_weeks: row.gestational_age_weeks,
          }),
          ...(row.neonatal_outcome !== undefined && {
            neonatal_outcome: row.neonatal_outcome,
          }),
          ...(row.complications !== undefined && {
            complications: row.complications,
          }),
          ...(row.notes !== undefined && { notes: row.notes }),
        },
      });
    }
    for (const row of toCreate) {
      await tx.patientPregnancyHistory.create({
        data: {
          patient_id: patientId,
          birth_date: row.birth_date ? new Date(row.birth_date) : null,
          outcome: row.outcome ?? null,
          mode_of_delivery: row.mode_of_delivery ?? null,
          gestational_age_weeks: row.gestational_age_weeks ?? null,
          neonatal_outcome: row.neonatal_outcome ?? null,
          complications: row.complications ?? null,
          notes: row.notes ?? null,
          created_by_id: profileId,
        },
      });
    }
    if (toDelete.length > 0) {
      await tx.patientPregnancyHistory.updateMany({
        where: { id: { in: toDelete } },
        data: { is_deleted: true, deleted_at: new Date() },
      });
    }
  }

  private async diffContraceptives(
    tx: Prisma.TransactionClient,
    patientId: string,
    prior: Array<{ id: string }>,
    rows: ContraceptiveRowDto[],
    profileId: string,
  ) {
    const liveIds = new Set(prior.map((p) => p.id));
    const { toUpdate, toCreate, toDelete } = this.splitDiff(rows, liveIds);
    for (const row of toUpdate) {
      await tx.patientContraceptiveHistory.update({
        where: { id: row.id! },
        data: {
          ...(row.method !== undefined && { method: row.method }),
          ...(row.duration !== undefined && { duration: row.duration }),
          ...(row.complications !== undefined && {
            complications: row.complications,
          }),
          ...(row.notes !== undefined && { notes: row.notes }),
        },
      });
    }
    for (const row of toCreate) {
      await tx.patientContraceptiveHistory.create({
        data: {
          patient_id: patientId,
          // Column is NOT NULL — coalesce missing values to "" so partial rows
          // (date-only contraceptive, e.g.) still persist.
          method: row.method ?? '',
          duration: row.duration ?? null,
          complications: row.complications ?? null,
          notes: row.notes ?? null,
          created_by_id: profileId,
        },
      });
    }
    if (toDelete.length > 0) {
      await tx.patientContraceptiveHistory.updateMany({
        where: { id: { in: toDelete } },
        data: { is_deleted: true, deleted_at: new Date() },
      });
    }
  }

  private async diffNonGynSurgeries(
    tx: Prisma.TransactionClient,
    patientId: string,
    prior: Array<{ id: string }>,
    rows: NonGynSurgeryRowDto[],
    profileId: string,
  ) {
    const liveIds = new Set(prior.map((p) => p.id));
    const { toUpdate, toCreate, toDelete } = this.splitDiff(rows, liveIds);
    for (const row of toUpdate) {
      await tx.patientNonGynSurgery.update({
        where: { id: row.id! },
        data: {
          ...(row.surgery_name !== undefined && {
            surgery_name: row.surgery_name,
          }),
          ...(row.surgery_date !== undefined && {
            surgery_date: row.surgery_date ? new Date(row.surgery_date) : null,
          }),
          ...(row.facility !== undefined && { facility: row.facility }),
          ...(row.notes !== undefined && { notes: row.notes }),
        },
      });
    }
    for (const row of toCreate) {
      await tx.patientNonGynSurgery.create({
        data: {
          patient_id: patientId,
          surgery_name: row.surgery_name ?? '',
          surgery_date: row.surgery_date ? new Date(row.surgery_date) : null,
          facility: row.facility ?? null,
          notes: row.notes ?? null,
          created_by_id: profileId,
        },
      });
    }
    if (toDelete.length > 0) {
      await tx.patientNonGynSurgery.updateMany({
        where: { id: { in: toDelete } },
        data: { is_deleted: true, deleted_at: new Date() },
      });
    }
  }

  private async diffMedications(
    tx: Prisma.TransactionClient,
    patientId: string,
    prior: Array<{ id: string }>,
    rows: MedicationRowDto[],
    profileId: string,
  ) {
    const liveIds = new Set(prior.map((p) => p.id));
    const { toUpdate, toCreate, toDelete } = this.splitDiff(rows, liveIds);
    for (const row of toUpdate) {
      await tx.patientMedication.update({
        where: { id: row.id! },
        data: {
          ...(row.drug_name !== undefined && { drug_name: row.drug_name }),
          ...(row.medication_id !== undefined && {
            medication_id: row.medication_id,
          }),
          ...(row.indication !== undefined && { indication: row.indication }),
          ...(row.dose !== undefined && { dose: row.dose }),
          ...(row.frequency !== undefined && { frequency: row.frequency }),
          ...(row.from_date !== undefined && {
            from_date: row.from_date ? new Date(row.from_date) : null,
          }),
          ...(row.to_date !== undefined && {
            to_date: row.to_date ? new Date(row.to_date) : null,
          }),
          ...(row.is_ongoing !== undefined && { is_ongoing: row.is_ongoing }),
          ...(row.notes !== undefined && { notes: row.notes }),
        },
      });
    }
    for (const row of toCreate) {
      await tx.patientMedication.create({
        data: {
          patient_id: patientId,
          medication_id: row.medication_id ?? null,
          drug_name: row.drug_name ?? '',
          indication: row.indication ?? null,
          dose: row.dose ?? null,
          frequency: row.frequency ?? null,
          from_date: row.from_date ? new Date(row.from_date) : null,
          to_date: row.to_date ? new Date(row.to_date) : null,
          is_ongoing: row.is_ongoing ?? true,
          notes: row.notes ?? null,
          created_by_id: profileId,
        },
      });
    }
    if (toDelete.length > 0) {
      await tx.patientMedication.updateMany({
        where: { id: { in: toDelete } },
        data: { is_deleted: true, deleted_at: new Date() },
      });
    }
  }

  private async diffAllergies(
    tx: Prisma.TransactionClient,
    patientId: string,
    prior: Array<{ id: string }>,
    rows: AllergyRowDto[],
    profileId: string,
  ) {
    const liveIds = new Set(prior.map((p) => p.id));
    const { toUpdate, toCreate, toDelete } = this.splitDiff(rows, liveIds);
    for (const row of toUpdate) {
      await tx.patientAllergy.update({
        where: { id: row.id! },
        data: {
          ...(row.allergy_to !== undefined && { allergy_to: row.allergy_to }),
          ...(row.associated_symptoms !== undefined && {
            associated_symptoms: row.associated_symptoms,
          }),
          ...(row.severity !== undefined && { severity: row.severity }),
          ...(row.notes !== undefined && { notes: row.notes }),
        },
      });
    }
    for (const row of toCreate) {
      await tx.patientAllergy.create({
        data: {
          patient_id: patientId,
          allergy_to: row.allergy_to ?? '',
          associated_symptoms: row.associated_symptoms ?? null,
          severity: row.severity ?? null,
          notes: row.notes ?? null,
          created_by_id: profileId,
        },
      });
    }
    if (toDelete.length > 0) {
      await tx.patientAllergy.updateMany({
        where: { id: { in: toDelete } },
        data: { is_deleted: true, deleted_at: new Date() },
      });
    }
  }

  /**
   * Auto-compute gravida/para/abortion cache from the current
   * `PatientPregnancyHistory` rows. Only called when pregnancies were
   * touched and the caller did NOT supply an explicit `obstetric_summary`.
   * Manual user input wins when supplied.
   */
  private async recomputeObstetricSummary(
    tx: Prisma.TransactionClient,
    patientId: string,
  ) {
    const rows = await tx.patientPregnancyHistory.findMany({
      where: { patient_id: patientId, is_deleted: false },
      select: { outcome: true, gestational_age_weeks: true },
    });
    let gravida = 0;
    let para = 0;
    let abortion = 0;
    for (const r of rows) {
      gravida += 1;
      const outcome = (r.outcome ?? '').toUpperCase();
      if (LIVE_BIRTH_OUTCOMES.includes(outcome)) {
        para += 1;
      } else if (
        outcome === 'STILLBIRTH' &&
        (r.gestational_age_weeks ?? 0) >= 20
      ) {
        para += 1;
      } else if (ABORTION_LIKE_OUTCOMES.includes(outcome)) {
        abortion += 1;
      }
    }
    return { gravida, para, abortion };
  }
}

// Re-export for tests that referenced the old constant name.
export type { SingletonJsonField };
