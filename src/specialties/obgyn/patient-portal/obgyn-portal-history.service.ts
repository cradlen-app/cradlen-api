import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { resolveAccessiblePatientIds } from '@core/patient/patient-portal/patient-portal.public';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface';
import { ObgynHistoryService } from '../patient-history/obgyn-history.service';
import {
  composeObgynHistoryGroup,
  type TemplateSectionInput,
} from './obgyn-portal-history.composer';
import { PortalHistoryResponseDto } from './dto/portal-history.dto';

const OBGYN_HISTORY_TEMPLATE_CODE = 'obgyn_patient_history';

/**
 * Patient-facing read of OB/GYN history. Resolves the target patient (gated by
 * the caller's accessible-patient set), reads the history envelope, and composes
 * display-ready groups against the active `obgyn_patient_history` template.
 *
 * Lives in the OB/GYN specialty layer (not core/patient-portal) because the data
 * source — `ObgynHistoryService.readEnvelope` — is specialty-owned and `core`
 * may not import `specialties`.
 */
@Injectable()
export class ObgynPortalHistoryService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly obgynHistoryService: ObgynHistoryService,
  ) {}

  async getHistory(
    ctx: PatientAuthContext,
    patientId?: string,
  ): Promise<PortalHistoryResponseDto> {
    // Throws a generic 404 if patientId is supplied but not accessible.
    const accessible = resolveAccessiblePatientIds(ctx, patientId);
    const targetId = accessible[0];
    if (!targetId) return { patient_id: '', groups: [] };

    const envelope = await this.obgynHistoryService.readEnvelope(targetId);
    if (!envelope) return { patient_id: targetId, groups: [] };

    const sections = await this.loadTemplateSections();
    const group = composeObgynHistoryGroup(
      sections,
      envelope as Record<string, unknown>,
    );

    return {
      patient_id: targetId,
      groups: group.sections.length > 0 ? [group] : [],
    };
  }

  /** Active OB/GYN patient-history template → ordered sections + fields. */
  private async loadTemplateSections(): Promise<TemplateSectionInput[]> {
    const template = await this.prismaService.db.formTemplate.findFirst({
      where: {
        code: OBGYN_HISTORY_TEMPLATE_CODE,
        is_active: true,
        is_deleted: false,
      },
      include: {
        sections: {
          where: { is_deleted: false },
          orderBy: { order: 'asc' },
          include: {
            fields: {
              where: { is_deleted: false },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });
    if (!template) return [];

    return template.sections.map((section) => ({
      code: section.code,
      name: section.name,
      is_repeatable: section.is_repeatable,
      fields: section.fields.map((field) => ({
        label: field.label,
        binding_path: field.binding_path,
        config: field.config,
      })),
    }));
  }
}
