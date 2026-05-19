import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { PatientAccessService } from './patient-access.service';
import { UpsertFieldFlagDto, UpdateFieldFlagNoteDto, FieldFlagDto } from './dto/field-flag.dto';

@Injectable()
export class FieldFlagsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly patientAccess: PatientAccessService,
  ) {}

  async list(patientId: string, user: AuthContext): Promise<FieldFlagDto[]> {
    await this.patientAccess.assertPatientInOrg(patientId, user);
    const flags = await this.prismaService.db.patientFieldFlag.findMany({
      where: {
        patient_id: patientId,
        organization_id: user.organizationId,
        is_deleted: false,
      },
      orderBy: { created_at: 'asc' },
    });
    return flags.map((f) => this.toDto(f));
  }

  async upsert(patientId: string, dto: UpsertFieldFlagDto, user: AuthContext): Promise<FieldFlagDto> {
    await this.patientAccess.assertPatientInOrg(patientId, user);
    // Last-writer-wins: re-flagging an existing field transfers authorship to the
    // caller. Only the current author can edit/remove, so this is intentional —
    // whoever raises the flag owns it.
    const flag = await this.prismaService.db.patientFieldFlag.upsert({
      where: {
        unique_flag_per_field: {
          patient_id: patientId,
          organization_id: user.organizationId,
          section_code: dto.section_code,
          field_code: dto.field_code,
        },
      },
      update: {
        note: dto.note ?? null,
        is_deleted: false,
        deleted_at: null,
        author_id: user.profileId,
      },
      create: {
        patient_id: patientId,
        organization_id: user.organizationId,
        author_id: user.profileId,
        section_code: dto.section_code,
        field_code: dto.field_code,
        note: dto.note ?? null,
      },
    });
    return this.toDto(flag);
  }

  async updateNote(flagId: string, dto: UpdateFieldFlagNoteDto, user: AuthContext): Promise<FieldFlagDto> {
    const flag = await this.loadOrThrow(flagId, user);
    const updated = await this.prismaService.db.patientFieldFlag.update({
      where: { id: flag.id },
      data: { ...(dto.note !== undefined ? { note: dto.note } : {}) },
    });
    return this.toDto(updated);
  }

  async remove(flagId: string, user: AuthContext): Promise<void> {
    const flag = await this.loadOrThrow(flagId, user);
    await this.prismaService.db.patientFieldFlag.update({
      where: { id: flag.id },
      data: { is_deleted: true, deleted_at: new Date() },
    });
  }

  private async loadOrThrow(flagId: string, user: AuthContext) {
    const flag = await this.prismaService.db.patientFieldFlag.findFirst({
      where: { id: flagId, organization_id: user.organizationId, is_deleted: false },
    });
    if (!flag) throw new NotFoundException('Field flag not found');
    if (flag.author_id !== user.profileId) throw new ForbiddenException('Not your flag');
    return flag;
  }

  private toDto(flag: {
    id: string;
    patient_id: string;
    organization_id: string;
    author_id: string;
    section_code: string;
    field_code: string;
    note: string | null;
    created_at: Date;
    updated_at: Date;
  }): FieldFlagDto {
    const dto = new FieldFlagDto();
    Object.assign(dto, flag);
    return dto;
  }
}
