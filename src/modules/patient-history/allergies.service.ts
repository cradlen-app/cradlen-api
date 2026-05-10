import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PatientAccessService } from './patient-access.service';
import { CreateAllergyDto, UpdateAllergyDto } from './dto/allergy.dto';

@Injectable()
export class AllergiesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly patientAccess: PatientAccessService,
  ) {}

  async findAll(patientId: string, user: AuthContext) {
    await this.patientAccess.assertPatientInOrg(patientId, user);
    return this.prismaService.db.patientAllergy.findMany({
      where: { patient_id: patientId, is_deleted: false },
      orderBy: { created_at: 'desc' },
    });
  }

  async create(patientId: string, dto: CreateAllergyDto, user: AuthContext) {
    await this.patientAccess.assertPatientInOrg(patientId, user);
    return this.prismaService.db.patientAllergy.create({
      data: {
        patient_id: patientId,
        allergy_to: dto.allergy_to,
        associated_symptoms: dto.associated_symptoms ?? null,
        severity: dto.severity ?? null,
        notes: dto.notes ?? null,
        created_by_id: user.profileId,
      },
    });
  }

  async update(id: string, dto: UpdateAllergyDto, user: AuthContext) {
    const row = await this.loadOrThrow(id, user);
    return this.prismaService.db.patientAllergy.update({
      where: { id: row.id },
      data: {
        ...(dto.allergy_to !== undefined && { allergy_to: dto.allergy_to }),
        ...(dto.associated_symptoms !== undefined && {
          associated_symptoms: dto.associated_symptoms,
        }),
        ...(dto.severity !== undefined && { severity: dto.severity }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
  }

  async remove(id: string, user: AuthContext) {
    const row = await this.loadOrThrow(id, user);
    await this.prismaService.db.patientAllergy.update({
      where: { id: row.id },
      data: { is_deleted: true, deleted_at: new Date() },
    });
  }

  private async loadOrThrow(id: string, user: AuthContext) {
    const row = await this.prismaService.db.patientAllergy.findUnique({
      where: { id, is_deleted: false },
    });
    if (!row) throw new NotFoundException(`Allergy ${id} not found`);
    await this.patientAccess.assertPatientInOrg(row.patient_id, user);
    return row;
  }
}
