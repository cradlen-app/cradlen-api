import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
import { UpdateObgynHistoryDto } from './dto/obgyn-history.dto';

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

// Repeatable child collections, now stored as JSON-array columns on the
// singleton (folded from former relational tables). The DTO/envelope key for
// each maps 1:1 to its `PatientObgynHistory` JSON column.
const CHILD_COLLECTIONS = [
  'pregnancies',
  'contraceptives',
  'non_gyn_surgeries',
  'gyn_surgeries',
  'family_members',
  'medications',
  'allergies',
] as const;

type ChildCollection = (typeof CHILD_COLLECTIONS)[number];
type StoredRow = Record<string, unknown> & { id: string };
type Children = Record<ChildCollection, StoredRow[]>;

const LIVE_BIRTH_OUTCOMES = ['LIVE_BIRTH'];
const ABORTION_LIKE_OUTCOMES = ['MISCARRIAGE', 'ABORTION', 'ECTOPIC'];
const ECTOPIC_OUTCOME = 'ECTOPIC';
const STILLBIRTH_OUTCOME = 'STILLBIRTH';
// A stillbirth counts toward parity only once the fetus is viable (>= 20 weeks).
const STILLBIRTH_VIABLE_WEEKS = 20;

// --- pure helpers -----------------------------------------------------------

/** Coerce a JSON column value to an array of stored rows (null/garbage → []). */
function coerceRows(value: unknown): StoredRow[] {
  return Array.isArray(value) ? (value as StoredRow[]) : [];
}

/** Provided row fields minus `id` and any `undefined` values. */
function rowFields(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'id' || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Descending comparator on a date-ish string field, `created_at` as tiebreak. */
function byDateDesc(field: string) {
  return (a: StoredRow, b: StoredRow): number => {
    const av = str(a[field]);
    const bv = str(b[field]);
    if (av !== bv) return av < bv ? 1 : -1; // empty sorts last (smallest)
    return str(b.created_at).localeCompare(str(a.created_at));
  };
}

function byCreatedDesc(a: StoredRow, b: StoredRow): number {
  return str(b.created_at).localeCompare(str(a.created_at));
}

function byMedication(a: StoredRow, b: StoredRow): number {
  const ao = a.is_ongoing === false ? 0 : 1;
  const bo = b.is_ongoing === false ? 0 : 1;
  if (ao !== bo) return bo - ao; // ongoing first
  const af = str(a.from_date);
  const bf = str(b.from_date);
  if (af !== bf) return af < bf ? 1 : -1;
  return str(b.created_at).localeCompare(str(a.created_at));
}

const COLLECTION_SORTERS: Record<
  ChildCollection,
  (a: StoredRow, b: StoredRow) => number
> = {
  pregnancies: byDateDesc('birth_date'),
  contraceptives: byCreatedDesc,
  non_gyn_surgeries: byDateDesc('surgery_date'),
  gyn_surgeries: byDateDesc('surgery_date'),
  family_members: byCreatedDesc,
  medications: byMedication,
  allergies: byCreatedDesc,
};

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
    return this.composeEnvelope(singleton);
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
    return this.composeEnvelope(singleton);
  }

  /**
   * Bulk write — accept the entire OB/GYN history surface in one call.
   *
   * NOTE: This is no longer exposed over HTTP. The patient-history surface is
   * read-only (GET = the "specialty full history" view). This method is kept
   * as the canonical internal writer — the OB/GYN examination flow calls into
   * it to persist patient-level history captured during an encounter.
   *
   * Singleton JSON columns + all seven child collections (pregnancies,
   * contraceptives, non_gyn_surgeries, gyn_surgeries, family_members,
   * medications, allergies) are diffed and written atomically. The collections live as JSON-array
   * columns on the singleton; each array element carries a stable `id` so the
   * id-keyed diff still applies: present id → update; missing id → create;
   * live id absent from the body → remove. A field absent from the body leaves
   * that collection untouched; sending it as `[]` clears the collection.
   *
   * Optimistic concurrency: client must echo the singleton row's current
   * `version` via `If-Match`. Inside one transaction we snapshot the prior
   * full state to `patient_obgyn_history_revisions`, apply the diff, then bump
   * `version`. One PATCH = one revision row = one event.
   */
  async patch(
    patientId: string,
    dto: UpdateObgynHistoryDto,
    ifMatchVersion: number,
    user: AuthContext,
  ) {
    await this.access.assertPatientInOrg(patientId, user);

    const singleton = await this.prismaService.db.$transaction((tx) =>
      this.applyPatch(tx, patientId, dto, ifMatchVersion, user.profileId),
    );
    return this.composeEnvelope(singleton);
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

    const priorChildren = this.loadChildren(current);
    const changedSections: string[] = [];

    const data: Prisma.PatientObgynHistoryUncheckedUpdateInput = {
      updated_by_id: profileId,
    };

    // ----- Singleton field updates (JSON columns) -----
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

    // ----- Child collection diffs (in-memory JSON-array merges) -----
    let newPregnancies = priorChildren.pregnancies;
    for (const key of CHILD_COLLECTIONS) {
      const incoming = (dto as Record<string, unknown>)[key] as
        | Array<{ id?: string }>
        | undefined;
      if (incoming === undefined) continue;
      const merged = this.diffCollection(
        priorChildren[key],
        incoming,
        profileId,
      );
      (data as Record<string, unknown>)[key] =
        merged as unknown as Prisma.InputJsonValue;
      if (key === 'pregnancies') newPregnancies = merged;
      changedSections.push(key);
    }

    // If pregnancies were touched but user did NOT supply obstetric_summary,
    // recompute G/P/A from the resulting pregnancy rows so the cached summary
    // stays in sync with the source of truth.
    const pregnanciesTouched = dto.pregnancies !== undefined;
    const summarySupplied = dto.obstetric_summary !== undefined;
    if (pregnanciesTouched && !summarySupplied) {
      data.obstetric_summary = this.computeObstetricSummary(
        newPregnancies,
      ) as unknown as Prisma.InputJsonValue;
      if (!changedSections.includes('obstetric_summary')) {
        changedSections.push('obstetric_summary');
      }
    }

    if (changedSections.length === 0) {
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

    // Snapshot the full prior state (singleton row already carries the child
    // JSON columns) before mutating. The revision's `version` field is the
    // prior version — buildRevision handles that.
    await tx.patientObgynHistoryRevision.create({
      data: buildRevision(current, changedSections, profileId),
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

    return updated;
  }

  /**
   * In-tx upsert of the journey-tagged pregnancy row in the patient's history
   * `pregnancies` collection. Called by the pregnancy activation/close flows
   * (and the surgical cesarean handoff) so the GTPAL obstetric summary tracks
   * the journey lifecycle: activation files the current pregnancy as ONGOING
   * (gravida includes the current pregnancy), close finalizes its outcome.
   * Adoption matches an untagged ONGOING row (prevents a double gravida when
   * the doctor pre-entered the current pregnancy manually).
   */
  async upsertJourneyPregnancyRow(
    tx: Prisma.TransactionClient,
    patientId: string,
    journeyId: string,
    patch: {
      outcome: string;
      mode_of_delivery?: string;
      gestational_age_weeks?: number;
      birth_date?: string;
      notes?: string;
    },
    profileId: string,
  ): Promise<void> {
    return this.upsertJourneyRow(
      tx,
      patientId,
      journeyId,
      'pregnancies',
      patch,
      profileId,
      (r) => str(r.outcome).toUpperCase() === 'ONGOING',
    );
  }

  /**
   * In-tx upsert of the journey-tagged surgery row in the patient's history
   * `gyn_surgeries` collection. Called by the surgical activation/close flows
   * so the gynecologic surgical history tracks the journey lifecycle:
   * activation files the surgery as PLANNED, close finalizes its outcome.
   *
   * Same adopt-or-append semantics as the pregnancy sync; adoption matches an
   * untagged still-planned row with the same `procedure_code` (a doctor may
   * have pre-entered the upcoming surgery manually).
   */
  async upsertJourneyGynSurgeryRow(
    tx: Prisma.TransactionClient,
    patientId: string,
    journeyId: string,
    patch: {
      outcome: string;
      procedure_code?: string;
      procedure_name?: string;
      surgery_date?: string;
      anesthesia_type?: string;
      complications?: string;
      notes?: string;
    },
    profileId: string,
  ): Promise<void> {
    return this.upsertJourneyRow(
      tx,
      patientId,
      journeyId,
      'gyn_surgeries',
      patch,
      profileId,
      (r) => {
        const outcome = str(r.outcome).toUpperCase();
        const stillPlanned = outcome === '' || outcome === 'PLANNED';
        return (
          stillPlanned &&
          !!patch.procedure_code &&
          r.procedure_code === patch.procedure_code
        );
      },
    );
  }

  /**
   * Shared core for the journey-lifecycle syncs above. Target selection: the
   * row already tagged with `journey_id`; else ADOPT the most recently created
   * untagged row matching `adoptUntagged` (prevents duplicating a manually
   * pre-entered row); else append a new row. Idempotent: when the target
   * already carries every patch field, returns without writing (no version
   * churn, revision, or event).
   *
   * Delegates to `applyPatch` with the FULL collection array (the collection
   * diff is upsert-and-delete-missing), so the revision snapshot, version
   * bump, `patient.history.updated` event — and, for pregnancies, the
   * obstetric-summary recompute — all ride the existing machinery.
   */
  private async upsertJourneyRow(
    tx: Prisma.TransactionClient,
    patientId: string,
    journeyId: string,
    collection: ChildCollection,
    patch: Record<string, unknown>,
    profileId: string,
    adoptUntagged: (row: StoredRow) => boolean,
  ): Promise<void> {
    const singleton = await this.loadOrCreateSingleton(
      tx,
      patientId,
      profileId,
    );
    const rows = coerceRows(singleton[collection]);

    const tagged = rows.find((r) => r.journey_id === journeyId);
    const adoptable = tagged
      ? undefined
      : [...rows]
          .filter((r) => !r.journey_id && adoptUntagged(r))
          .sort(byCreatedDesc)[0];
    const target = tagged ?? adoptable;

    const fields = rowFields({ ...patch, journey_id: journeyId });
    if (target && Object.entries(fields).every(([k, v]) => target[k] === v)) {
      return; // Already in sync — avoid version/revision/event churn.
    }

    const nextRows = target
      ? rows.map((r) => (r.id === target.id ? { ...r, ...fields } : r))
      : [...rows, fields]; // No `id` → diffCollection creates the row.

    await this.applyPatch(
      tx,
      patientId,
      { [collection]: nextRows } as unknown as UpdateObgynHistoryDto,
      null,
      profileId,
    );
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

  /** Read the child-collection JSON-array columns off the singleton (unsorted). */
  private loadChildren(singleton: Record<string, unknown>): Children {
    return CHILD_COLLECTIONS.reduce((acc, key) => {
      acc[key] = coerceRows(singleton[key]);
      return acc;
    }, {} as Children);
  }

  private composeEnvelope(singleton: Record<string, unknown>) {
    const children = this.loadChildren(singleton);
    const sorted = CHILD_COLLECTIONS.reduce((acc, key) => {
      acc[key] = [...children[key]].sort(COLLECTION_SORTERS[key]);
      return acc;
    }, {} as Children);
    return { ...singleton, ...sorted };
  }

  /**
   * id-keyed merge of one collection, producing the new JSON array:
   *   - present id matching a live row → field-merge over the prior row
   *   - new/unknown id → append with a fresh `id`, `created_by_id`, `created_at`
   *   - live id absent from the request → drop (history is kept in the revision
   *     snapshot, so no soft-delete tombstone is needed in the live array)
   * Prior order is preserved for surviving rows; creates are appended.
   */
  private diffCollection(
    prior: StoredRow[],
    rows: Array<{ id?: string }>,
    profileId: string,
  ): StoredRow[] {
    const liveIds = new Set(prior.map((p) => p.id));
    const { toUpdate, toCreate, toDelete } = splitDiff(rows, liveIds);
    const updById = new Map(
      toUpdate.map((r) => [r.id as string, r as Record<string, unknown>]),
    );
    const del = new Set(toDelete);

    const result: StoredRow[] = [];
    for (const p of prior) {
      if (del.has(p.id)) continue;
      const upd = updById.get(p.id);
      result.push(upd ? { ...p, ...rowFields(upd) } : p);
    }

    const now = new Date().toISOString();
    for (const r of toCreate) {
      result.push({
        id: randomUUID(),
        created_by_id: profileId,
        created_at: now,
        ...rowFields(r as Record<string, unknown>),
      });
    }
    return result;
  }

  /**
   * Auto-compute the full obstetric-summary cache (gravida/para/abortion/
   * ectopic/stillbirths) from the current pregnancy rows. Only called when
   * pregnancies were touched and the caller did NOT supply an explicit
   * `obstetric_summary`. Manual user input wins when supplied.
   *
   * Counting rules: every row counts toward gravida (including ONGOING and
   * OTHER); ECTOPIC counts in both `abortion` and its own `ectopic` counter;
   * `stillbirths` counts every stillbirth row while the >= 20-week viability
   * rule gates `para` only.
   */
  private computeObstetricSummary(pregnancies: StoredRow[]) {
    let gravida = 0;
    let para = 0;
    let abortion = 0;
    let ectopic = 0;
    let stillbirths = 0;
    for (const r of pregnancies) {
      gravida += 1;
      const outcome = str(r.outcome).toUpperCase();
      const ga =
        typeof r.gestational_age_weeks === 'number'
          ? r.gestational_age_weeks
          : 0;
      if (LIVE_BIRTH_OUTCOMES.includes(outcome)) {
        para += 1;
      } else if (outcome === STILLBIRTH_OUTCOME) {
        stillbirths += 1;
        if (ga >= STILLBIRTH_VIABLE_WEEKS) {
          para += 1;
        }
      } else if (ABORTION_LIKE_OUTCOMES.includes(outcome)) {
        abortion += 1;
        if (outcome === ECTOPIC_OUTCOME) {
          ectopic += 1;
        }
      }
    }
    return { gravida, para, abortion, ectopic, stillbirths };
  }
}

// Re-export for tests that referenced the old constant name.
export type { SingletonJsonField };
