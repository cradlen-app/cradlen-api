import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { buildRevision } from '@common/utils/revisions.helper';
import { VisitAccessService } from './visit-access.service';
import { UpsertEncounterDto } from './dto/encounter.dto';

@Injectable()
export class EncounterService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly visitAccess: VisitAccessService,
  ) {}

  async findOne(visitId: string, user: AuthContext) {
    const visit = await this.visitAccess.loadOrThrow(visitId, user);
    await this.visitAccess.assertBranchAccess(visit, user);
    return this.prismaService.db.visitEncounter.findUnique({
      where: { visit_id: visitId, is_deleted: false },
    });
  }

  async upsert(visitId: string, dto: UpsertEncounterDto, user: AuthContext) {
    const visit = await this.visitAccess.loadOrThrow(visitId, user);
    this.visitAccess.assertCanWriteEncounter(visit, user);

    const fields: Omit<Prisma.VisitEncounterUncheckedCreateInput, 'visit_id'> =
      {
        chief_complaint: dto.chief_complaint ?? null,
        chief_complaint_meta: this.toJson(dto.chief_complaint_meta),
        history_present_illness: dto.history_present_illness ?? null,
        general_findings: this.toJson(dto.general_findings),
        cardiovascular_findings: this.toJson(dto.cardiovascular_findings),
        respiratory_findings: this.toJson(dto.respiratory_findings),
        menstrual_findings: this.toJson(dto.menstrual_findings),
        abdominal_findings: this.toJson(dto.abdominal_findings),
        pelvic_findings: this.toJson(dto.pelvic_findings),
        breast_findings: this.toJson(dto.breast_findings),
        extremities_findings: this.toJson(dto.extremities_findings),
        neurological_findings: this.toJson(dto.neurological_findings),
        skin_findings: this.toJson(dto.skin_findings),
        provisional_diagnosis: dto.provisional_diagnosis ?? null,
        diagnosis_code: dto.diagnosis_code ?? null,
        diagnosis_certainty: dto.diagnosis_certainty ?? null,
        clinical_reasoning: dto.clinical_reasoning ?? null,
        case_path: dto.case_path ?? null,
      };

    const prior = await this.prismaService.db.visitEncounter.findUnique({
      where: { visit_id: visitId },
    });

    if (!prior) {
      return this.prismaService.db.visitEncounter.create({
        data: { visit_id: visitId, updated_by_id: user.profileId, ...fields },
      });
    }

    const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter(
      (k) =>
        JSON.stringify((prior as Record<string, unknown>)[k as string]) !==
        JSON.stringify(fields[k]),
    );

    return this.prismaService.db.$transaction(async (tx) => {
      if (changed.length > 0) {
        await tx.visitEncounterRevision.create({
          data: buildRevision(prior, changed as string[], user.profileId),
        });
      }
      return tx.visitEncounter.update({
        where: { id: prior.id },
        data: {
          ...fields,
          updated_by_id: user.profileId,
          ...(changed.length > 0 ? { version: { increment: 1 } } : {}),
        },
      });
    });
  }

  private toJson(
    value: unknown,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === undefined || value === null) return Prisma.JsonNull;
    return value as Prisma.InputJsonValue;
  }
}
