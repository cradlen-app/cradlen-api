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
import { splitDiff } from '@common/utils/id-keyed-diff';
import { coerceStringRecord } from '@common/utils/json.utils';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.public';
import { buildRevision } from '../revisions.helper';
import {
  AllergyRowDto,
  ContraceptiveRowDto,
  FamilyHistoryRowDto,
  MedicationRowDto,
  NonGynSurgeryRowDto,
  PregnancyRowDto,
  UpdateObgynHistoryDto,
} from './dto/obgyn-history.dto';

const SINGLETON_JSON_FIELDS = [
  'gynecological_baseline',
  'gynecologic_procedures',
  'gynecologic_conditions',
  'sexual_history',
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
const STILLBIRTH_OUTCOME = 'STILLBIRTH';
// A stillbirth counts toward parity only once the fetus is viable (>= 20 weeks).
const STILLBIRTH_VIABLE_WEEKS = 20;

@Injectable()
export class ObgynHistoryService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly access: PatientAccessService,
    private readonly eventBus: EventBus,
  ) {}

  async get(patientId: string, user: AuthContext) {
    await this.access.assertPatientAccessible(patientId, user);
    const singleton = await this.loadOrCreateSingleton(
      this.prismaService.db,
      patientId,
      user.profileId,
    );
    return this.composeEnvelope(this.prismaService.db, singleton);
  }

  /**
   * Read-only history envelope for EMBEDDING in another surface (the OB/GYN
   * examination GET pre-fills the care-path-relevant history sections from
   * this). Performs NO access check — the caller must already have authorized
   * the patient — and does NOT lazy-create the singleton (returns `null` when
   * the patient has no history yet, so a read never has a write side-effect).
   */
  async readEnvelope(
    patientId: string,
    tx: Prisma.TransactionClient | typeof this.prismaService.db = this
      .prismaService.db,
  ) {
    const singleton = await tx.patientObgynHistory.findUnique({
      where: { patient_id: patientId },
    });
    if (!singleton) return null;
    return this.composeEnvelope(tx, singleton);
  }

  /**
   * Bulk write — accept the entire OB/GYN history surface in one call.
   *
   * NOTE: This is no longer exposed over HTTP. The patient-history surface is
   * read-only (GET = the "specialty full history" view). This method is kept
   * as the canonical internal writer — the OB/GYN examination flow will call
   * into it to persist patient-level history captured during an encounter
   * (see plan: history capture relocates to the examination template).
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

    // Compose the read-back envelope OUTSIDE the write transaction so the
    // transaction does no extra child-table reads (applyPatch returns just the
    // singleton row). Keeps this wrapper's public shape unchanged.
    const singleton = await this.prismaService.db.$transaction((tx) =>
      this.applyPatch(tx, patientId, dto, ifMatchVersion, user.profileId),
    );
    return this.composeEnvelope(this.prismaService.db, singleton);
  }

  /**
   * Transaction-composable core of the history write. Callers own the
   * transaction so the patient-level write can ride along with other mutations
   * (e.g. the OB/GYN examination PATCH writing visit-scoped data + history in
   * one atomic transaction).
   *
   * `ifMatchVersion === null` skips the optimistic-concurrency assert — used by
   * the examination flow, which is already guarded by `examination_version`.
   * Pass the singleton's current `version` to enforce If-Match (the HTTP path).
   *
   * Snapshots the prior state to `patient_obgyn_history_revisions`, bumps
   * `version`, and emits one `patient.history.updated` event.
   */
  async applyPatch(
    tx: Prisma.TransactionClient,
    patientId: string,
    dto: UpdateObgynHistoryDto,
    ifMatchVersion: number | null,
    profileId: string,
  ) {
    const current = await this.loadOrCreateSingleton(tx, patientId, profileId);
    if (ifMatchVersion !== null) {
      assertVersionMatches(ifMatchVersion, current.version);
    }

    const priorChildren = await this.loadChildren(tx, patientId);
    const changedSections: string[] = [];

    // ----- Singleton field updates (JSON columns) -----
    const data: Prisma.PatientObgynHistoryUncheckedUpdateInput = {
      updated_by_id: profileId,
    };
    for (const field of SINGLETON_JSON_FIELDS) {
      if (!(field in dto)) continue;
      const value = (dto as Record<string, unknown>)[field];
      (data as Record<string, unknown>)[field] = value as Prisma.InputJsonValue;
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
        profileId,
      );
      changedSections.push('pregnancies');
    }
    if (dto.contraceptives !== undefined) {
      await this.diffContraceptives(
        tx,
        patientId,
        priorChildren.contraceptives,
        dto.contraceptives,
        profileId,
      );
      changedSections.push('contraceptives');
    }
    if (dto.non_gyn_surgeries !== undefined) {
      await this.diffNonGynSurgeries(
        tx,
        patientId,
        priorChildren.non_gyn_surgeries,
        dto.non_gyn_surgeries,
        profileId,
      );
      changedSections.push('non_gyn_surgeries');
    }
    if (dto.family_members !== undefined) {
      await this.diffFamilyHistory(
        tx,
        patientId,
        priorChildren.family_members,
        dto.family_members,
        profileId,
      );
      changedSections.push('family_members');
    }
    if (dto.medications !== undefined) {
      await this.diffMedications(
        tx,
        patientId,
        priorChildren.medications,
        dto.medications,
        profileId,
      );
      changedSections.push('medications');
    }
    if (dto.allergies !== undefined) {
      await this.diffAllergies(
        tx,
        patientId,
        priorChildren.allergies,
        dto.allergies,
        profileId,
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
      // No envelope read-back inside the tx — callers compose outside it.
      return current;
    }

    const now = new Date().toISOString();
    const existingTimestamps =
      coerceStringRecord(current.section_timestamps) ?? {};
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
      data: buildRevision(priorSnapshot, changedSections, profileId),
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
        updated_by_id: profileId,
        version: updated.version,
      },
    );

    // Return the lightweight singleton; callers compose the full envelope
    // outside the write transaction (the examination flow discards it).
    return updated;
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
      family_members,
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
      tx.patientFamilyHistory.findMany({
        where,
        orderBy: { created_at: 'desc' },
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
      family_members,
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

  private async diffPregnancies(
    tx: Prisma.TransactionClient,
    patientId: string,
    prior: Array<{ id: string }>,
    rows: PregnancyRowDto[],
    profileId: string,
  ) {
    const liveIds = new Set(prior.map((p) => p.id));
    const { toUpdate, toCreate, toDelete } = splitDiff(rows, liveIds);
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
          ...(row.mode_of_delivery_other !== undefined && {
            mode_of_delivery_other: row.mode_of_delivery_other,
          }),
          ...(row.gestational_age_weeks !== undefined && {
            gestational_age_weeks: row.gestational_age_weeks,
          }),
          ...(row.neonatal_outcome !== undefined && {
            neonatal_outcome: row.neonatal_outcome,
          }),
          ...(row.neonatal_outcome_other !== undefined && {
            neonatal_outcome_other: row.neonatal_outcome_other,
          }),
          ...(row.baby_weight !== undefined && {
            baby_weight: row.baby_weight,
          }),
          ...(row.baby_sex !== undefined && { baby_sex: row.baby_sex }),
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
          mode_of_delivery_other: row.mode_of_delivery_other ?? null,
          gestational_age_weeks: row.gestational_age_weeks ?? null,
          neonatal_outcome: row.neonatal_outcome ?? null,
          neonatal_outcome_other: row.neonatal_outcome_other ?? null,
          baby_weight: row.baby_weight ?? null,
          baby_sex: row.baby_sex ?? null,
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
    const { toUpdate, toCreate, toDelete } = splitDiff(rows, liveIds);
    for (const row of toUpdate) {
      await tx.patientContraceptiveHistory.update({
        where: { id: row.id! },
        data: {
          ...(row.method !== undefined && { method: row.method }),
          ...(row.method_other !== undefined && {
            method_other: row.method_other,
          }),
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
          method_other: row.method_other ?? null,
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
    const { toUpdate, toCreate, toDelete } = splitDiff(rows, liveIds);
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

  private async diffFamilyHistory(
    tx: Prisma.TransactionClient,
    patientId: string,
    prior: Array<{ id: string }>,
    rows: FamilyHistoryRowDto[],
    profileId: string,
  ) {
    const liveIds = new Set(prior.map((p) => p.id));
    const { toUpdate, toCreate, toDelete } = splitDiff(rows, liveIds);
    for (const row of toUpdate) {
      await tx.patientFamilyHistory.update({
        where: { id: row.id! },
        data: {
          ...(row.condition !== undefined && { condition: row.condition }),
          ...(row.relative !== undefined && { relative: row.relative }),
          ...(row.age_of_diagnosis !== undefined && {
            age_of_diagnosis: row.age_of_diagnosis,
          }),
          ...(row.notes !== undefined && { notes: row.notes }),
        },
      });
    }
    for (const row of toCreate) {
      await tx.patientFamilyHistory.create({
        data: {
          patient_id: patientId,
          condition: row.condition ?? '',
          relative: row.relative ?? null,
          age_of_diagnosis: row.age_of_diagnosis ?? null,
          notes: row.notes ?? null,
          created_by_id: profileId,
        },
      });
    }
    if (toDelete.length > 0) {
      await tx.patientFamilyHistory.updateMany({
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
    const { toUpdate, toCreate, toDelete } = splitDiff(rows, liveIds);
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
    const { toUpdate, toCreate, toDelete } = splitDiff(rows, liveIds);
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
        outcome === STILLBIRTH_OUTCOME &&
        (r.gestational_age_weeks ?? 0) >= STILLBIRTH_VIABLE_WEEKS
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
