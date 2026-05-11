import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { VisitAccessService } from './visit-access.service';
import { UpsertEncounterDto } from './dto/encounter.dto';
import { FormTemplateResolverService } from '../form-templates/form-template-resolver.service';
import {
  FormSchema,
  FormSchemaValidatorService,
} from '../form-templates/form-schema-validator.service';

const ENCOUNTER_INCLUDE = {
  form_template_version: {
    select: { id: true, version_number: true, schema: true },
  },
} satisfies Prisma.VisitEncounterInclude;

@Injectable()
export class EncounterService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly visitAccess: VisitAccessService,
    private readonly resolver: FormTemplateResolverService,
    private readonly validator: FormSchemaValidatorService,
  ) {}

  async findOne(visitId: string, user: AuthContext) {
    const visit = await this.visitAccess.loadOrThrow(visitId, user);
    await this.visitAccess.assertBranchAccess(visit, user);
    return this.prismaService.db.visitEncounter.findUnique({
      where: { visit_id: visitId },
      include: ENCOUNTER_INCLUDE,
    });
  }

  async upsert(visitId: string, dto: UpsertEncounterDto, user: AuthContext) {
    const visit = await this.visitAccess.loadOrThrow(visitId, user);
    this.visitAccess.assertCanWriteEncounter(visit, user);

    const existing = await this.prismaService.db.visitEncounter.findUnique({
      where: { visit_id: visitId },
      include: { form_template_version: true },
    });

    const version =
      existing?.form_template_version ??
      (await this.resolver.resolveForEncounter({
        profileId: visit.assigned_doctor_id,
        organizationId: user.organizationId,
      }));

    const sanitizedResponses = this.sanitizeResponses(
      version.schema,
      dto.responses,
    );

    const data: Prisma.VisitEncounterUncheckedCreateInput = {
      visit_id: visitId,
      form_template_version_id: version.id,
      chief_complaint: dto.chief_complaint ?? null,
      chief_complaint_meta: this.toJson(dto.chief_complaint_meta),
      history_present_illness: dto.history_present_illness ?? null,
      responses: sanitizedResponses as Prisma.InputJsonValue,
      provisional_diagnosis: dto.provisional_diagnosis ?? null,
      diagnosis_code: dto.diagnosis_code ?? null,
      diagnosis_certainty: dto.diagnosis_certainty ?? null,
      clinical_reasoning: dto.clinical_reasoning ?? null,
      case_path: dto.case_path ?? null,
    };

    const updateData: Omit<typeof data, 'visit_id'> = { ...data };
    delete (updateData as { visit_id?: string }).visit_id;

    return this.prismaService.db.visitEncounter.upsert({
      where: { visit_id: visitId },
      create: data,
      update: updateData,
      include: ENCOUNTER_INCLUDE,
    });
  }

  private sanitizeResponses(
    schema: unknown,
    responses: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    const result = this.validator.validate(schema as FormSchema, responses);
    if (!result.valid) {
      throw new BadRequestException({
        message:
          'Encounter responses failed validation against the template schema.',
        fields: result.errors,
      });
    }
    return result.sanitized;
  }

  private toJson(
    value: unknown,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === undefined || value === null) return Prisma.JsonNull;
    return value as Prisma.InputJsonValue;
  }
}
