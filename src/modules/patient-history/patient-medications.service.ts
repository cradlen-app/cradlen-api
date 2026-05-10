import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { MedicationsService } from '../medications/medications.service';
import { PatientAccessService } from './patient-access.service';
import {
  CreatePatientMedicationDto,
  UpdatePatientMedicationDto,
} from './dto/patient-medication.dto';

@Injectable()
export class PatientMedicationsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly patientAccess: PatientAccessService,
    private readonly medicationsService: MedicationsService,
  ) {}

  async findAll(patientId: string, user: AuthContext) {
    await this.patientAccess.assertPatientInOrg(patientId, user);
    return this.prismaService.db.patientMedication.findMany({
      where: { patient_id: patientId, is_deleted: false },
      orderBy: [
        { is_ongoing: 'desc' },
        { from_date: 'desc' },
        { created_at: 'desc' },
      ],
    });
  }

  async create(
    patientId: string,
    dto: CreatePatientMedicationDto,
    user: AuthContext,
  ) {
    await this.patientAccess.assertPatientInOrg(patientId, user);
    if (dto.medication_id) {
      await this.medicationsService.assertReferenceable(
        dto.medication_id,
        user,
      );
    }
    return this.prismaService.db.patientMedication.create({
      data: {
        patient_id: patientId,
        medication_id: dto.medication_id ?? null,
        drug_name: dto.drug_name,
        indication: dto.indication ?? null,
        dose: dto.dose ?? null,
        frequency: dto.frequency ?? null,
        from_date: dto.from_date ? new Date(dto.from_date) : null,
        to_date: dto.to_date ? new Date(dto.to_date) : null,
        is_ongoing: dto.is_ongoing ?? true,
        notes: dto.notes ?? null,
        created_by_id: user.profileId,
      },
    });
  }

  async update(id: string, dto: UpdatePatientMedicationDto, user: AuthContext) {
    const row = await this.loadOrThrow(id, user);
    if (dto.medication_id) {
      await this.medicationsService.assertReferenceable(
        dto.medication_id,
        user,
      );
    }
    return this.prismaService.db.patientMedication.update({
      where: { id: row.id },
      data: {
        ...(dto.drug_name !== undefined && { drug_name: dto.drug_name }),
        ...(dto.medication_id !== undefined && {
          medication_id: dto.medication_id,
        }),
        ...(dto.indication !== undefined && { indication: dto.indication }),
        ...(dto.dose !== undefined && { dose: dto.dose }),
        ...(dto.frequency !== undefined && { frequency: dto.frequency }),
        ...(dto.from_date !== undefined && {
          from_date: dto.from_date ? new Date(dto.from_date) : null,
        }),
        ...(dto.to_date !== undefined && {
          to_date: dto.to_date ? new Date(dto.to_date) : null,
        }),
        ...(dto.is_ongoing !== undefined && { is_ongoing: dto.is_ongoing }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
  }

  async remove(id: string, user: AuthContext) {
    const row = await this.loadOrThrow(id, user);
    await this.prismaService.db.patientMedication.update({
      where: { id: row.id },
      data: { is_deleted: true, deleted_at: new Date() },
    });
  }

  private async loadOrThrow(id: string, user: AuthContext) {
    const row = await this.prismaService.db.patientMedication.findUnique({
      where: { id, is_deleted: false },
    });
    if (!row) throw new NotFoundException(`Patient medication ${id} not found`);
    await this.patientAccess.assertPatientInOrg(row.patient_id, user);
    return row;
  }
}
