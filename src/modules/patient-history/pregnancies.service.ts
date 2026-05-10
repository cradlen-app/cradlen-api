import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PatientAccessService } from './patient-access.service';
import { CreatePregnancyDto, UpdatePregnancyDto } from './dto/pregnancy.dto';

const LIVE_BIRTH_OUTCOMES = ['LIVE_BIRTH'];
const ABORTION_LIKE_OUTCOMES = ['MISCARRIAGE', 'ABORTION', 'ECTOPIC'];

@Injectable()
export class PregnanciesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly patientAccess: PatientAccessService,
  ) {}

  async findAll(patientId: string, user: AuthContext) {
    await this.patientAccess.assertPatientInOrg(patientId, user);
    return this.prismaService.db.patientPregnancyHistory.findMany({
      where: { patient_id: patientId, is_deleted: false },
      orderBy: [{ birth_date: 'desc' }, { created_at: 'desc' }],
    });
  }

  async create(patientId: string, dto: CreatePregnancyDto, user: AuthContext) {
    await this.patientAccess.assertPatientInOrg(patientId, user);
    return this.prismaService.db.$transaction(async (tx) => {
      const created = await tx.patientPregnancyHistory.create({
        data: {
          patient_id: patientId,
          birth_date: dto.birth_date ? new Date(dto.birth_date) : null,
          outcome: dto.outcome ?? null,
          mode_of_delivery: dto.mode_of_delivery ?? null,
          gestational_age_weeks: dto.gestational_age_weeks ?? null,
          neonatal_outcome: dto.neonatal_outcome ?? null,
          complications: dto.complications ?? null,
          notes: dto.notes ?? null,
          created_by_id: user.profileId,
        },
      });
      await this.recomputeObstetricSummary(tx, patientId);
      return created;
    });
  }

  async update(id: string, dto: UpdatePregnancyDto, user: AuthContext) {
    const row = await this.loadOrThrow(id, user);
    return this.prismaService.db.$transaction(async (tx) => {
      const updated = await tx.patientPregnancyHistory.update({
        where: { id: row.id },
        data: {
          ...(dto.birth_date !== undefined && {
            birth_date: dto.birth_date ? new Date(dto.birth_date) : null,
          }),
          ...(dto.outcome !== undefined && { outcome: dto.outcome }),
          ...(dto.mode_of_delivery !== undefined && {
            mode_of_delivery: dto.mode_of_delivery,
          }),
          ...(dto.gestational_age_weeks !== undefined && {
            gestational_age_weeks: dto.gestational_age_weeks,
          }),
          ...(dto.neonatal_outcome !== undefined && {
            neonatal_outcome: dto.neonatal_outcome,
          }),
          ...(dto.complications !== undefined && {
            complications: dto.complications,
          }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
        },
      });
      await this.recomputeObstetricSummary(tx, row.patient_id);
      return updated;
    });
  }

  async remove(id: string, user: AuthContext) {
    const row = await this.loadOrThrow(id, user);
    await this.prismaService.db.$transaction(async (tx) => {
      await tx.patientPregnancyHistory.update({
        where: { id: row.id },
        data: { is_deleted: true, deleted_at: new Date() },
      });
      await this.recomputeObstetricSummary(tx, row.patient_id);
    });
  }

  /**
   * Gravida = total pregnancies (excluding ongoing? we count all unless OUTCOME=ONGOING)
   * Para    = pregnancies that resulted in LIVE_BIRTH or STILLBIRTH at >=20 weeks
   * Abortion = MISCARRIAGE | ABORTION | ECTOPIC
   * Server-computed cache; UI may also expose manual override fields if clinical
   * judgment differs (out of scope for now).
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
    await tx.patient.update({
      where: { id: patientId },
      data: {
        obstetric_summary: { gravida, para, abortion },
      },
    });
  }

  private async loadOrThrow(id: string, user: AuthContext) {
    const row = await this.prismaService.db.patientPregnancyHistory.findUnique({
      where: { id, is_deleted: false },
    });
    if (!row) throw new NotFoundException(`Pregnancy ${id} not found`);
    await this.patientAccess.assertPatientInOrg(row.patient_id, user);
    return row;
  }
}
