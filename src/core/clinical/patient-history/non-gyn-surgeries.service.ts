import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { PatientAccessService } from './patient-access.service';
import {
  CreateNonGynSurgeryDto,
  UpdateNonGynSurgeryDto,
} from './dto/non-gyn-surgery.dto';

@Injectable()
export class NonGynSurgeriesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly patientAccess: PatientAccessService,
  ) {}

  async findAll(patientId: string, user: AuthContext) {
    await this.patientAccess.assertPatientInOrg(patientId, user);
    return this.prismaService.db.patientNonGynSurgery.findMany({
      where: { patient_id: patientId, is_deleted: false },
      orderBy: [{ surgery_date: 'desc' }, { created_at: 'desc' }],
    });
  }

  async create(
    patientId: string,
    dto: CreateNonGynSurgeryDto,
    user: AuthContext,
  ) {
    await this.patientAccess.assertPatientInOrg(patientId, user);
    return this.prismaService.db.patientNonGynSurgery.create({
      data: {
        patient_id: patientId,
        surgery_name: dto.surgery_name,
        surgery_date: dto.surgery_date ? new Date(dto.surgery_date) : null,
        facility: dto.facility ?? null,
        notes: dto.notes ?? null,
        created_by_id: user.profileId,
      },
    });
  }

  async update(id: string, dto: UpdateNonGynSurgeryDto, user: AuthContext) {
    const row = await this.loadOrThrow(id, user);
    return this.prismaService.db.patientNonGynSurgery.update({
      where: { id: row.id },
      data: {
        ...(dto.surgery_name !== undefined && {
          surgery_name: dto.surgery_name,
        }),
        ...(dto.surgery_date !== undefined && {
          surgery_date: dto.surgery_date ? new Date(dto.surgery_date) : null,
        }),
        ...(dto.facility !== undefined && { facility: dto.facility }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
  }

  async remove(id: string, user: AuthContext) {
    const row = await this.loadOrThrow(id, user);
    await this.prismaService.db.patientNonGynSurgery.update({
      where: { id: row.id },
      data: { is_deleted: true, deleted_at: new Date() },
    });
  }

  private async loadOrThrow(id: string, user: AuthContext) {
    const row = await this.prismaService.db.patientNonGynSurgery.findUnique({
      where: { id, is_deleted: false },
    });
    if (!row) throw new NotFoundException(`Surgery ${id} not found`);
    await this.patientAccess.assertPatientInOrg(row.patient_id, user);
    return row;
  }
}
