import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { splitDiff } from '@common/utils/id-keyed-diff';
import { EventBus } from '@infrastructure/messaging/event-bus';
import {
  CLINICAL_EVENTS,
  type JourneyCarePathSetEvent,
  type VisitExaminationUpdatedEvent,
} from '@core/clinical/events/events.public';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.public';
import { buildRevision } from '../revisions.helper';
import { assertCarePathChangeAllowed } from '../pregnancy/pregnancy-care-path.guard';
import { ObgynHistoryService } from '../patient-history/obgyn-history.service';
import {
  DiagnosisRowDto,
  InvestigationRowDto,
  MedicationItemRowDto,
  UpdateObgynExaminationDto,
} from './dto/obgyn-examination.dto';

const OBGYN_JSON_SECTIONS = [
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

const ENCOUNTER_SCALAR_FIELDS = [
  'chief_complaint',
  'provisional_diagnosis',
  'diagnosis_code',
  'diagnosis_certainty',
  'clinical_reasoning',
  'case_path',
] as const;

const VITALS_FIELDS = [
  'systolic_bp',
  'diastolic_bp',
  'pulse',
  'temperature_c',
  'respiratory_rate',
  'spo2',
  'weight_kg',
  'height_cm',
  'rbs_mmol_l',
] as const;

/** Derive a stable upper-snake catalog code from a free-typed name. */
function slugifyCode(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

/**
 * Unified PATCH service for the Examination tab.
 *
 * One request → one Prisma transaction across five aggregates:
 *   1. VisitEncounter      (chief complaint + provisional diagnosis)
 *   2. VisitVitals         (BMI recomputed server-side)
 *   3. VisitObgynEncounter (all 10 body-system findings sections)
 *   4. VisitInvestigation  (id-keyed row diff)
 *   5. Prescription + PrescriptionItem (singleton + id-keyed row diff)
 *   + Visit.follow_up_date + Visit.examination_version bump
 *
 * Last-write-wins on open visits: there is no `If-Match` precondition.
 * `Visit.examination_version` still increments on every save (change/cache
 * token + FE remount key), but a stale client token never rejects the write —
 * the surface is edited by a single assigned doctor, and closed visits are
 * already blocked by `EncounterMutationGuard`. Per-aggregate
 * revision rows are written for the entities that have shadow tables
 * (VisitEncounter, VisitObgynEncounter, Prescription, PrescriptionItem);
 * VisitVitals and VisitInvestigation have no revision table today and
 * skip the snapshot write.
 */
@Injectable()
export class ObgynExaminationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly access: PatientAccessService,
    private readonly eventBus: EventBus,
    private readonly obgynHistory: ObgynHistoryService,
  ) {}

  /** Resolve the patient that owns a visit via episode → journey. */
  private async resolvePatientId(
    tx: Prisma.TransactionClient | typeof this.prismaService.db,
    visitId: string,
  ): Promise<string> {
    const visit = await tx.visit.findUnique({
      where: { id: visitId },
      select: {
        episode: { select: { journey: { select: { patient_id: true } } } },
      },
    });
    const patientId = visit?.episode?.journey?.patient_id;
    if (!patientId) {
      throw new NotFoundException(`Patient for visit ${visitId} not found`);
    }
    return patientId;
  }

  /**
   * Apply the doctor's in-visit care-path choice to the visit's active journey.
   * The care path is a clinical decision, so the journey (not just the visit's
   * encounter snapshot) is the source of truth: updating `care_path_id`
   * re-drives the care-path-relevant history sections and the journey
   * descriptor. Returns the event payload to publish, or `null` when the journey
   * already follows this care path (no change). Throws 400 on an unknown code.
   */
  private async applyCarePathToJourney(
    tx: Prisma.TransactionClient,
    visitId: string,
    carePathCode: string,
    organizationId: string,
    profileId: string,
  ): Promise<JourneyCarePathSetEvent | null> {
    const visit = await tx.visit.findUnique({
      where: { id: visitId },
      select: {
        specialty_code: true,
        episode: {
          select: {
            journey: {
              select: {
                id: true,
                patient_id: true,
                care_path: { select: { code: true } },
              },
            },
          },
        },
      },
    });
    const journey = visit?.episode?.journey;
    if (!journey) {
      throw new NotFoundException(`Journey for visit ${visitId} not found`);
    }
    const previousCode = journey.care_path?.code ?? null;
    if (previousCode === carePathCode) return null;

    // Resolve the target care path for the visit's specialty (org ∪ system),
    // preferring an org-specific override over the global fallback.
    const carePath = await tx.carePath.findFirst({
      where: {
        code: carePathCode,
        is_deleted: false,
        ...(visit.specialty_code
          ? { specialty: { code: visit.specialty_code, is_deleted: false } }
          : {}),
        OR: [{ organization_id: null }, { organization_id: organizationId }],
      },
      orderBy: [{ organization_id: { sort: 'desc', nulls: 'last' } }],
      select: { id: true },
    });
    if (!carePath) {
      throw new BadRequestException(
        `Care path "${carePathCode}" not found for this visit's specialty`,
      );
    }

    // An ACTIVE pregnancy locks the journey's care path — it must be closed
    // (delivery/outcome) before switching to a different (resolved) care path.
    await assertCarePathChangeAllowed(tx, journey.id, carePathCode);

    await tx.patientJourney.update({
      where: { id: journey.id },
      data: { care_path_id: carePath.id },
    });

    return {
      journey_id: journey.id,
      visit_id: visitId,
      patient_id: journey.patient_id,
      previous_care_path_code: previousCode,
      new_care_path_code: carePathCode,
      updated_by_id: profileId,
    };
  }

  // ---------------------------------------------------------------------------
  // GET — combined envelope
  // ---------------------------------------------------------------------------

  async get(visitId: string, user: AuthContext) {
    await this.access.assertVisitInOrg(visitId, user);
    return this.composeEnvelope(this.prismaService.db, visitId);
  }

  private async composeEnvelope(
    tx: Prisma.TransactionClient | typeof this.prismaService.db,
    visitId: string,
  ) {
    const [
      visit,
      encounter,
      vitals,
      obgyn,
      investigations,
      diagnoses,
      prescription,
    ] = await Promise.all([
      tx.visit.findUnique({
        where: { id: visitId },
        include: {
          episode: {
            select: {
              journey: {
                select: {
                  patient_id: true,
                  care_path: { select: { code: true } },
                },
              },
            },
          },
        },
      }),
      tx.visitEncounter.findUnique({ where: { visit_id: visitId } }),
      tx.visitVitals.findUnique({ where: { visit_id: visitId } }),
      tx.visitObgynEncounter.findUnique({ where: { visit_id: visitId } }),
      tx.visitInvestigation.findMany({
        where: { visit_id: visitId, is_deleted: false },
        orderBy: { created_at: 'asc' },
        // Fold in the catalog test name + attachment metadata so the read-only
        // results view can show name + an attachment count (no object_key /
        // presigned URLs — files are not downloaded from this surface).
        include: {
          lab_test: { select: { name: true } },
          result_attachments: {
            where: { is_deleted: false },
            select: { id: true, source: true, content_type: true },
          },
        },
      }),
      tx.visitDiagnosis.findMany({
        where: { visit_id: visitId, is_deleted: false },
        orderBy: [{ is_primary: 'desc' }, { order: 'asc' }],
      }),
      tx.prescription.findUnique({
        where: { visit_id: visitId },
        include: {
          items: {
            where: { is_deleted: false },
            orderBy: { order: 'asc' },
          },
        },
      }),
    ]);

    // Patient-level history (for pre-filling the care-path-relevant `history_*`
    // sections) + the journey's care path so the picker defaults to where
    // booking left off when the encounter hasn't set its own `case_path` yet.
    const patientId = visit?.episode?.journey?.patient_id ?? null;
    const obgynHistory = patientId
      ? await this.obgynHistory.readEnvelope(patientId, tx)
      : null;
    const journeyCarePathCode =
      visit?.episode?.journey?.care_path?.code ?? null;

    return {
      visit_id: visitId,
      // VisitEncounter scalars
      chief_complaint: encounter?.chief_complaint ?? null,
      chief_complaint_meta: encounter?.chief_complaint_meta ?? null,
      provisional_diagnosis: encounter?.provisional_diagnosis ?? null,
      diagnosis_code: encounter?.diagnosis_code ?? null,
      diagnosis_certainty: encounter?.diagnosis_certainty ?? null,
      clinical_reasoning: encounter?.clinical_reasoning ?? null,
      case_path: encounter?.case_path ?? journeyCarePathCode,
      // Vitals (column-wise, not nested) so FE bindings can read each field by name
      vitals: vitals
        ? {
            systolic_bp: vitals.systolic_bp,
            diastolic_bp: vitals.diastolic_bp,
            pulse: vitals.pulse,
            temperature_c: vitals.temperature_c,
            respiratory_rate: vitals.respiratory_rate,
            spo2: vitals.spo2,
            weight_kg: vitals.weight_kg,
            height_cm: vitals.height_cm,
            bmi: vitals.bmi,
            rbs_mmol_l: vitals.rbs_mmol_l,
          }
        : null,
      // OB/GYN JSON sections (all 10 body-system findings)
      general_findings: obgyn?.general_findings ?? null,
      cardiovascular_findings: obgyn?.cardiovascular_findings ?? null,
      respiratory_findings: obgyn?.respiratory_findings ?? null,
      menstrual_findings: obgyn?.menstrual_findings ?? null,
      abdominal_findings: obgyn?.abdominal_findings ?? null,
      pelvic_findings: obgyn?.pelvic_findings ?? null,
      breast_findings: obgyn?.breast_findings ?? null,
      extremities_findings: obgyn?.extremities_findings ?? null,
      neurological_findings: obgyn?.neurological_findings ?? null,
      skin_findings: obgyn?.skin_findings ?? null,
      // Repeatable rows
      diagnoses: diagnoses,
      investigations: investigations,
      medications: prescription?.items ?? [],
      // Patient-level OB/GYN history envelope (pre-fills care-path history sections)
      obgyn_history: obgynHistory,
      // Visit-level
      follow_up_date: visit?.follow_up_date ?? null,
      examination_version: visit?.examination_version ?? 1,
      // Precondition token for `obgyn_encounter` amendments
      // (POST /visits/:id/amendments). The examination GET is reachable on
      // closed visits, so this is the documented source for that If-Match.
      obgyn_encounter_version: obgyn?.version ?? 1,
      updated_at: visit?.updated_at ?? new Date(),
    };
  }

  // ---------------------------------------------------------------------------
  // PATCH — unified orchestration
  // ---------------------------------------------------------------------------

  async patch(
    visitId: string,
    dto: UpdateObgynExaminationDto,
    user: AuthContext,
  ) {
    await this.access.assertVisitInOrg(visitId, user);

    await this.prismaService.db.$transaction(
      async (tx) => {
        const visit = await tx.visit.findUnique({ where: { id: visitId } });
        if (!visit) throw new NotFoundException(`Visit ${visitId} not found`);
        // Open-visit examination is a single-doctor surface → last-write-wins.
        // No optimistic-concurrency precondition: `examination_version` still
        // increments (change/cache token), but a stale client token no longer
        // rejects the save. Closed visits are blocked upstream by
        // EncounterMutationGuard (@LocksOnClosedVisit); amendments carry their
        // own per-row version precondition.

        const aggregates: string[] = [];

        // ---- (0) VisitDiagnosis rows (structured ICD-10 list) ----
        // Mirror the primary diagnosis onto the encounter scalars so the
        // free-text `provisional_diagnosis` (completion guard, history summaries)
        // stays in sync. Runs before the encounter write so the derived values
        // ride the same upsert + revision.
        if (dto.diagnoses !== undefined) {
          await this.diffDiagnoses(
            tx,
            visitId,
            dto.diagnoses,
            user.profileId,
            visit.specialty_code,
          );
          const primary = await this.resolvePrimaryDiagnosis(tx, visitId);
          const scalars = dto as Record<string, unknown>;
          scalars.provisional_diagnosis = primary?.description ?? '';
          scalars.diagnosis_code = primary?.code ?? null;
          scalars.diagnosis_certainty = primary?.certainty ?? null;
          aggregates.push('diagnoses');
        }

        // ---- (1) VisitEncounter (chief complaint + provisional diagnosis) ----
        if (this.touchesEncounter(dto)) {
          await this.upsertEncounter(tx, visitId, dto, user.profileId);
          aggregates.push('encounter');
        }

        // ---- (1b) Active journey care path (doctor's in-visit decision) ----
        // `case_path` is written onto the encounter above for the per-visit
        // record; here we make the JOURNEY the single source of truth so the
        // care-path-relevant history sections + journey descriptor follow the
        // doctor's choice. No-op when unchanged or unset.
        if (dto.case_path) {
          const evt = await this.applyCarePathToJourney(
            tx,
            visitId,
            dto.case_path,
            user.organizationId,
            user.profileId,
          );
          if (evt) {
            this.eventBus.publish<JourneyCarePathSetEvent>(
              CLINICAL_EVENTS.journey.carePathSet,
              evt,
            );
            aggregates.push('care_path');
          }
        }

        // ---- (2) VisitVitals (BMI server-recomputed) ----
        if (dto.vitals !== undefined) {
          await this.upsertVitals(tx, visitId, dto.vitals, user.profileId);
          aggregates.push('vitals');
        }

        // ---- (3) VisitObgynEncounter (all 10 body-system findings sections) ----
        if (this.touchesObgynEncounter(dto)) {
          await this.upsertObgynEncounter(tx, visitId, dto, user.profileId);
          aggregates.push('obgyn_encounter');
        }

        // ---- (4) VisitInvestigation rows ----
        if (dto.investigations !== undefined) {
          await this.diffInvestigations(
            tx,
            visitId,
            dto.investigations,
            user.profileId,
            user.organizationId,
          );
          aggregates.push('investigations');
        }

        // ---- (5) Prescription + PrescriptionItem rows ----
        if (dto.medications !== undefined) {
          await this.diffPrescriptionItems(
            tx,
            visitId,
            dto.medications,
            user.profileId,
          );
          aggregates.push('prescription');
        }

        // ---- (6) Patient-level OB/GYN history (care-path-relevant capture) ----
        // Routed to PatientObgynHistory (single source of truth) in THIS
        // transaction. `null` If-Match: the examination's own examination_version
        // already guards concurrency, so the history write reads + bumps the
        // current history version in-tx without a separate client precondition.
        if (dto.obgyn_history !== undefined) {
          const patientId = await this.resolvePatientId(tx, visitId);
          await this.obgynHistory.applyPatch(
            tx,
            patientId,
            dto.obgyn_history,
            null,
            user.profileId,
          );
          aggregates.push('obgyn_history');
        }

        // ---- Visit-level: follow_up_date + version bump ----
        const visitData: Prisma.VisitUncheckedUpdateInput = {
          examination_version: { increment: 1 },
        };
        if (dto.follow_up_date !== undefined) {
          visitData.follow_up_date = dto.follow_up_date
            ? new Date(dto.follow_up_date)
            : null;
          aggregates.push('follow_up_date');
        }
        const updatedVisit = await tx.visit.update({
          where: { id: visitId },
          data: visitData,
        });

        this.eventBus.publish<VisitExaminationUpdatedEvent>(
          CLINICAL_EVENTS.encounter.examinationUpdated,
          {
            visit_id: visitId,
            aggregates,
            updated_by_id: user.profileId,
            examination_version: updatedVisit.examination_version,
          },
        );
      },
      // The composite examination write spans many aggregates (encounter,
      // vitals, 10 findings sections, diagnoses/investigations/prescription
      // diffs, and the full patient-history diff). On Neon, interactive-tx
      // queries serialize on one connection, so the legitimate work can exceed
      // Prisma's 5s default. Give it real headroom.
      { timeout: 20_000, maxWait: 10_000 },
    );

    return this.composeEnvelope(this.prismaService.db, visitId);
  }

  // ---------------------------------------------------------------------------
  // Aggregate writers
  // ---------------------------------------------------------------------------

  private touchesEncounter(dto: UpdateObgynExaminationDto): boolean {
    if (dto.chief_complaint_meta !== undefined) return true;
    for (const f of ENCOUNTER_SCALAR_FIELDS) {
      if ((dto as Record<string, unknown>)[f] !== undefined) return true;
    }
    return false;
  }

  private touchesObgynEncounter(dto: UpdateObgynExaminationDto): boolean {
    for (const s of OBGYN_JSON_SECTIONS) {
      if ((dto as Record<string, unknown>)[s] !== undefined) return true;
    }
    return false;
  }

  private async upsertEncounter(
    tx: Prisma.TransactionClient,
    visitId: string,
    dto: UpdateObgynExaminationDto,
    profileId: string,
  ) {
    const existing = await tx.visitEncounter.findUnique({
      where: { visit_id: visitId },
    });

    const data: Prisma.VisitEncounterUncheckedUpdateInput = {
      updated_by_id: profileId,
      version: { increment: 1 },
    };
    const changed: string[] = [];

    for (const field of ENCOUNTER_SCALAR_FIELDS) {
      const value = (dto as Record<string, unknown>)[field];
      if (value === undefined) continue;
      (data as Record<string, unknown>)[field] = value;
      changed.push(field);
    }
    if (dto.chief_complaint_meta !== undefined) {
      data.chief_complaint_meta =
        dto.chief_complaint_meta as unknown as Prisma.InputJsonValue;
      changed.push('chief_complaint_meta');
    }

    if (!existing) {
      const createData: Prisma.VisitEncounterUncheckedCreateInput = {
        visit_id: visitId,
        updated_by_id: profileId,
      };
      for (const field of ENCOUNTER_SCALAR_FIELDS) {
        const value = (dto as Record<string, unknown>)[field];
        if (value === undefined) continue;
        (createData as Record<string, unknown>)[field] = value;
      }
      if (dto.chief_complaint_meta !== undefined) {
        createData.chief_complaint_meta =
          dto.chief_complaint_meta as unknown as Prisma.InputJsonValue;
      }
      await tx.visitEncounter.create({ data: createData });
      return;
    }

    if (changed.length === 0) return;

    await tx.visitEncounterRevision.create({
      data: buildRevision(existing, changed, profileId),
    });
    await tx.visitEncounter.update({
      where: { id: existing.id },
      data,
    });
  }

  private async upsertVitals(
    tx: Prisma.TransactionClient,
    visitId: string,
    vitals: NonNullable<UpdateObgynExaminationDto['vitals']>,
    profileId: string,
  ) {
    // BMI server-recomputed when both weight + height present, even if the
    // client supplied an explicit value (the field is COMPUTED in the
    // template; client value is advisory).
    const bmi = this.computeBmi(vitals.weight_kg, vitals.height_cm);

    const data: Prisma.VisitVitalsUncheckedUpdateInput = {};
    for (const field of VITALS_FIELDS) {
      const value = (vitals as Record<string, unknown>)[field];
      if (value === undefined) continue;
      (data as Record<string, unknown>)[field] = value;
    }
    if (bmi !== null) data.bmi = bmi;

    const existing = await tx.visitVitals.findUnique({
      where: { visit_id: visitId },
    });

    if (!existing) {
      const createData: Prisma.VisitVitalsUncheckedCreateInput = {
        visit_id: visitId,
        recorded_by_id: profileId,
      };
      for (const field of VITALS_FIELDS) {
        const value = (vitals as Record<string, unknown>)[field];
        if (value === undefined) continue;
        (createData as Record<string, unknown>)[field] = value;
      }
      if (bmi !== null) createData.bmi = bmi;
      await tx.visitVitals.create({ data: createData });
      return;
    }

    if (Object.keys(data).length === 0) return;
    await tx.visitVitals.update({ where: { id: existing.id }, data });
  }

  /**
   * BMI = weight_kg / (height_m^2). Returns null if either input is
   * missing. Rounded to 1 decimal place to match the column's
   * Decimal(4,1) precision.
   */
  private computeBmi(
    weightKg: number | undefined,
    heightCm: number | undefined,
  ): number | null {
    if (weightKg === undefined || heightCm === undefined) return null;
    if (weightKg <= 0 || heightCm <= 0) return null;
    const heightM = heightCm / 100;
    const bmi = weightKg / (heightM * heightM);
    return Math.round(bmi * 10) / 10;
  }

  private async upsertObgynEncounter(
    tx: Prisma.TransactionClient,
    visitId: string,
    dto: UpdateObgynExaminationDto,
    profileId: string,
  ) {
    const existing = await tx.visitObgynEncounter.findUnique({
      where: { visit_id: visitId },
    });

    const data: Prisma.VisitObgynEncounterUncheckedUpdateInput = {
      updated_by_id: profileId,
      version: { increment: 1 },
    };
    const changed: string[] = [];
    for (const section of OBGYN_JSON_SECTIONS) {
      const value = (dto as Record<string, unknown>)[section];
      if (value === undefined) continue;
      (data as Record<string, unknown>)[section] =
        value as Prisma.InputJsonValue;
      changed.push(section);
    }

    if (!existing) {
      const createData: Prisma.VisitObgynEncounterUncheckedCreateInput = {
        visit_id: visitId,
        updated_by_id: profileId,
      };
      for (const section of OBGYN_JSON_SECTIONS) {
        const value = (dto as Record<string, unknown>)[section];
        if (value === undefined) continue;
        (createData as Record<string, unknown>)[section] =
          value as Prisma.InputJsonValue;
      }
      await tx.visitObgynEncounter.create({ data: createData });
      return;
    }

    if (changed.length === 0) return;

    await tx.visitObgynEncounterRevision.create({
      data: buildRevision(existing, changed, profileId),
    });
    await tx.visitObgynEncounter.update({
      where: { id: existing.id },
      data,
    });
  }

  // ---------------------------------------------------------------------------
  // Repeatable diff helpers (id-keyed: upsert / create / soft-delete)
  // ---------------------------------------------------------------------------

  /** The primary diagnosis (or first by order) of a visit's live rows, or null. */
  private async resolvePrimaryDiagnosis(
    tx: Prisma.TransactionClient,
    visitId: string,
  ) {
    const rows = await tx.visitDiagnosis.findMany({
      where: { visit_id: visitId, is_deleted: false },
      orderBy: [{ is_primary: 'desc' }, { order: 'asc' }],
      select: { code: true, description: true, certainty: true },
      take: 1,
    });
    return rows[0] ?? null;
  }

  private async diffDiagnoses(
    tx: Prisma.TransactionClient,
    visitId: string,
    rows: DiagnosisRowDto[],
    profileId: string,
    specialtyCode: string | null,
  ) {
    const prior = await tx.visitDiagnosis.findMany({
      where: { visit_id: visitId, is_deleted: false },
      select: { id: true, order: true },
    });
    const liveIds = new Set(prior.map((p) => p.id));
    const { toUpdate, toCreate, toDelete } = splitDiff(rows, liveIds);

    for (const row of toUpdate) {
      await tx.visitDiagnosis.update({
        where: { id: row.id! },
        data: {
          ...(row.code !== undefined && { code: row.code }),
          ...(row.description !== undefined && {
            description: row.description,
          }),
          ...(row.is_primary !== undefined && { is_primary: row.is_primary }),
          ...(row.certainty !== undefined && { certainty: row.certainty }),
        },
      });
    }
    let nextOrder = prior.reduce((max, p) => Math.max(max, p.order + 1), 0);
    for (const row of toCreate) {
      await tx.visitDiagnosis.create({
        data: {
          visit_id: visitId,
          code: row.code ?? '',
          description: row.description ?? '',
          is_primary: row.is_primary ?? false,
          certainty: row.certainty ?? null,
          order: nextOrder++,
          created_by_id: profileId,
        },
      });
    }
    if (toDelete.length > 0) {
      await tx.visitDiagnosis.updateMany({
        where: { id: { in: toDelete } },
        data: { is_deleted: true, deleted_at: new Date() },
      });
    }

    await this.registerNovelDiagnosisCodes(tx, rows, profileId, specialtyCode);
  }

  /**
   * Add any diagnosis the doctor typed by hand (a code + description not yet in
   * the catalog) to the shared `diagnosis_codes` table, tagged USER + the
   * authoring profile. Picked-from-catalog codes already exist and are skipped;
   * existing SYSTEM rows are never clobbered (we only create missing codes).
   * Free text without a code stays visit-only (the catalog is keyed by `code`).
   */
  private async registerNovelDiagnosisCodes(
    tx: Prisma.TransactionClient,
    rows: DiagnosisRowDto[],
    profileId: string,
    specialtyCode: string | null,
  ) {
    const candidates = new Map<string, string>(); // code → description
    for (const row of rows) {
      const code = row.code?.trim();
      const description = row.description?.trim();
      if (code && description && !candidates.has(code)) {
        candidates.set(code, description);
      }
    }
    if (candidates.size === 0) return;

    const existing = await tx.diagnosisCode.findMany({
      where: { code: { in: [...candidates.keys()] } },
      select: { code: true },
    });
    for (const e of existing) candidates.delete(e.code);
    if (candidates.size === 0) return;

    await tx.diagnosisCode.createMany({
      data: [...candidates.entries()].map(([code, description]) => ({
        code,
        description,
        specialty_code: specialtyCode,
        source: 'USER' as const,
        created_by_id: profileId,
        billable: true,
      })),
      skipDuplicates: true,
    });
  }

  private async diffInvestigations(
    tx: Prisma.TransactionClient,
    visitId: string,
    rows: InvestigationRowDto[],
    profileId: string,
    orgId: string,
  ) {
    // Free-typed tests (no picked lab_test_id) are registered in the catalog
    // and linked back, so future searches find them. Mutates row.lab_test_id.
    await this.linkNovelLabTests(tx, rows, profileId, orgId);

    const prior = await tx.visitInvestigation.findMany({
      where: { visit_id: visitId, is_deleted: false },
      select: { id: true },
    });
    const liveIds = new Set(prior.map((p) => p.id));
    const { toUpdate, toCreate, toDelete } = splitDiff(rows, liveIds);

    for (const row of toUpdate) {
      await tx.visitInvestigation.update({
        where: { id: row.id! },
        data: {
          ...(row.lab_test_id !== undefined && {
            lab_test_id: row.lab_test_id,
          }),
          ...(row.custom_test_name !== undefined && {
            custom_test_name: row.custom_test_name,
          }),
          ...(row.test_category !== undefined && {
            test_category: row.test_category,
          }),
          ...(row.lab_facility !== undefined && {
            lab_facility: row.lab_facility,
          }),
          ...(row.notes !== undefined && { notes: row.notes }),
          updated_by_id: profileId,
          version: { increment: 1 },
        },
      });
    }
    for (const row of toCreate) {
      await tx.visitInvestigation.create({
        data: {
          visit_id: visitId,
          lab_test_id: row.lab_test_id ?? null,
          custom_test_name: row.custom_test_name ?? null,
          test_category: row.test_category ?? null,
          lab_facility: row.lab_facility ?? null,
          notes: row.notes ?? null,
          ordered_by_id: profileId,
        },
      });
    }
    if (toDelete.length > 0) {
      await tx.visitInvestigation.updateMany({
        where: { id: { in: toDelete } },
        data: { is_deleted: true, deleted_at: new Date() },
      });
    }
  }

  /**
   * For each row the doctor typed by hand (a test name with no picked
   * `lab_test_id`), resolve-or-create an org-scoped `LabTest` (tagged with the
   * authoring profile) and write its id back onto the row so the investigation
   * links to the catalog. Reuses an existing global/org row with the same code
   * or name; never clobbers it. Skips rows already linked to a catalog test.
   */
  private async linkNovelLabTests(
    tx: Prisma.TransactionClient,
    rows: InvestigationRowDto[],
    profileId: string,
    orgId: string,
  ) {
    const cache = new Map<string, string>(); // code → resolved LabTest id
    for (const row of rows) {
      if (row.lab_test_id) continue;
      const name = row.custom_test_name?.trim();
      if (!name) continue;
      const code = slugifyCode(name);
      if (!code) continue;

      const cached = cache.get(code);
      if (cached) {
        row.lab_test_id = cached;
        continue;
      }

      const existing = await tx.labTest.findFirst({
        where: {
          is_deleted: false,
          AND: [
            { OR: [{ organization_id: null }, { organization_id: orgId }] },
            { OR: [{ code }, { name: { equals: name, mode: 'insensitive' } }] },
          ],
        },
        select: { id: true },
      });
      let id = existing?.id;
      if (!id) {
        try {
          const created = await tx.labTest.create({
            data: {
              organization_id: orgId,
              code,
              name,
              category: row.test_category ?? 'OTHER',
              added_by_id: profileId,
            },
            select: { id: true },
          });
          id = created.id;
        } catch (err) {
          // Concurrent create on the (organization_id, code) unique → refetch.
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            const refetched = await tx.labTest.findFirst({
              where: { organization_id: orgId, code },
              select: { id: true },
            });
            id = refetched?.id;
          } else {
            throw err;
          }
        }
      }
      if (id) {
        cache.set(code, id);
        row.lab_test_id = id;
      }
    }
  }

  private async diffPrescriptionItems(
    tx: Prisma.TransactionClient,
    visitId: string,
    rows: MedicationItemRowDto[],
    profileId: string,
  ) {
    // Ensure the Prescription singleton exists (medications imply a Rx).
    let prescription = await tx.prescription.findUnique({
      where: { visit_id: visitId },
    });
    if (!prescription) {
      prescription = await tx.prescription.create({
        data: { visit_id: visitId, prescribed_by_id: profileId },
      });
    }

    const prior = await tx.prescriptionItem.findMany({
      where: { prescription_id: prescription.id, is_deleted: false },
      select: { id: true, order: true },
    });
    const liveIds = new Set(prior.map((p) => p.id));
    const { toUpdate, toCreate, toDelete } = splitDiff(rows, liveIds);

    // Snapshot prescription for revision before any item write.
    if (toUpdate.length > 0 || toCreate.length > 0 || toDelete.length > 0) {
      const fullPrior = await tx.prescription.findUnique({
        where: { id: prescription.id },
        include: { items: { where: { is_deleted: false } } },
      });
      if (fullPrior) {
        await tx.prescriptionRevision.create({
          data: buildRevision(fullPrior, ['items'], profileId),
        });
      }
    }

    for (const row of toUpdate) {
      await tx.prescriptionItem.update({
        where: { id: row.id! },
        data: {
          ...(row.medication_id !== undefined && {
            medication_id: row.medication_id,
          }),
          ...(row.custom_drug_name !== undefined && {
            custom_drug_name: row.custom_drug_name,
          }),
          // `dose` and `frequency` are NOT NULL on the column; coalesce to "".
          ...(row.dose !== undefined && { dose: row.dose }),
          ...(row.frequency !== undefined && { frequency: row.frequency }),
          ...(row.duration !== undefined && {
            duration: row.duration,
          }),
          ...(row.instructions !== undefined && {
            instructions: row.instructions,
          }),
          updated_by_id: profileId,
          version: { increment: 1 },
        },
      });
    }
    let nextOrder = prior.reduce((max, p) => Math.max(max, p.order + 1), 0);
    for (const row of toCreate) {
      await tx.prescriptionItem.create({
        data: {
          prescription_id: prescription.id,
          medication_id: row.medication_id ?? null,
          custom_drug_name: row.custom_drug_name ?? null,
          // NOT NULL columns — keep empty string when caller omits.
          dose: row.dose ?? '',
          frequency: row.frequency ?? '',
          duration: row.duration ?? null,
          instructions: row.instructions ?? null,
          order: nextOrder++,
        },
      });
    }
    if (toDelete.length > 0) {
      await tx.prescriptionItem.updateMany({
        where: { id: { in: toDelete } },
        data: { is_deleted: true, deleted_at: new Date() },
      });
    }
  }
}
