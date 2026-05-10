import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PatientAccessService } from './patient-access.service';
import {
  CreateContraceptiveDto,
  UpdateContraceptiveDto,
} from './dto/contraceptive.dto';

@Injectable()
export class ContraceptivesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly patientAccess: PatientAccessService,
  ) {}

  async findAll(patientId: string, user: AuthContext) {
    await this.patientAccess.assertPatientInOrg(patientId, user);
    return this.prismaService.db.patientContraceptiveHistory.findMany({
      where: { patient_id: patientId, is_deleted: false },
      orderBy: { created_at: 'desc' },
    });
  }

  async create(
    patientId: string,
    dto: CreateContraceptiveDto,
    user: AuthContext,
  ) {
    await this.patientAccess.assertPatientInOrg(patientId, user);
    return this.prismaService.db.patientContraceptiveHistory.create({
      data: {
        patient_id: patientId,
        method: dto.method,
        duration: dto.duration ?? null,
        complications: dto.complications ?? null,
        notes: dto.notes ?? null,
        created_by_id: user.profileId,
      },
    });
  }

  async update(id: string, dto: UpdateContraceptiveDto, user: AuthContext) {
    const row = await this.loadOrThrow(id, user);
    return this.prismaService.db.patientContraceptiveHistory.update({
      where: { id: row.id },
      data: {
        ...(dto.method !== undefined && { method: dto.method }),
        ...(dto.duration !== undefined && { duration: dto.duration }),
        ...(dto.complications !== undefined && {
          complications: dto.complications,
        }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
  }

  async remove(id: string, user: AuthContext) {
    const row = await this.loadOrThrow(id, user);
    await this.prismaService.db.patientContraceptiveHistory.update({
      where: { id: row.id },
      data: { is_deleted: true, deleted_at: new Date() },
    });
  }

  private async loadOrThrow(id: string, user: AuthContext) {
    const row =
      await this.prismaService.db.patientContraceptiveHistory.findUnique({
        where: { id, is_deleted: false },
      });
    if (!row)
      throw new NotFoundException(`Contraceptive entry ${id} not found`);
    await this.patientAccess.assertPatientInOrg(row.patient_id, user);
    return row;
  }
}
