import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { assertVersionMatches } from '@common/decorators/if-match.decorator';
import { splitDiff } from '@common/utils/id-keyed-diff';
import { EventBus } from '@infrastructure/messaging/event-bus';
import {
  CLINICAL_EVENTS,
  type VisitExaminationUpdatedEvent,
} from '@core/clinical/events/events.public';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.public';
import { buildRevision } from '../revisions.helper';
import { ObgynHistoryService } from '../patient-history/obgyn-history.service';
import {
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
 * Optimistic concurrency uses a single token: `Visit.examination_version`,
 * supplied by the client via `If-Match: "version:<n>"`. Per-aggregate
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
    const [visit, encounter, vitals, obgyn, investigations, prescription] =
      await Promise.all([
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
    ifMatchVersion: number,
    user: AuthContext,
  ) {
    await this.access.assertVisitInOrg(visitId, user);

    await this.prismaService.db.$transaction(async (tx) => {
      const visit = await tx.visit.findUnique({ where: { id: visitId } });
      if (!visit) throw new NotFoundException(`Visit ${visitId} not found`);
      assertVersionMatches(ifMatchVersion, visit.examination_version);

      const aggregates: string[] = [];

      // ---- (1) VisitEncounter (chief complaint + provisional diagnosis) ----
      if (this.touchesEncounter(dto)) {
        await this.upsertEncounter(tx, visitId, dto, user.profileId);
        aggregates.push('encounter');
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
    });

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

  private async diffInvestigations(
    tx: Prisma.TransactionClient,
    visitId: string,
    rows: InvestigationRowDto[],
    profileId: string,
  ) {
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
          ...(row.duration_days !== undefined && {
            duration_days: row.duration_days,
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
          duration_days: row.duration_days ?? null,
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
