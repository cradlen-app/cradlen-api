import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.public.js';
import { PhiAuditService } from '../phi-audit/phi-audit.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { PatientExportDto } from './dto/patient-export.dto.js';

/**
 * Assembles a data-subject-access / portability export for a patient, scoped to
 * the caller's organization. OWNER-only (the controller fulfilling a DSAR). The
 * export is itself a PHI access event, so it also records a `phi_access_log`
 * row. Financial records are intentionally out of this first bundle (medical
 * record + consents only).
 */
@Injectable()
export class PatientExportService {
  private readonly logger = new Logger(PatientExportService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly patientAccess: PatientAccessService,
    private readonly phiAudit: PhiAuditService,
  ) {}

  async exportPatient(
    patientId: string,
    user: AuthContext,
  ): Promise<PatientExportDto> {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      user.organizationId,
    );
    await this.patientAccess.assertPatientInOrg(patientId, user);

    const orgId = user.organizationId;
    const db = this.prismaService.db;

    const [patient, journeys, obgynHistory, consents] = await Promise.all([
      db.patient.findUnique({
        where: { id: patientId },
        select: {
          id: true,
          national_id: true,
          full_name: true,
          date_of_birth: true,
          phone_number: true,
          address: true,
          marital_status: true,
          created_at: true,
        },
      }),
      db.patientJourney.findMany({
        where: {
          patient_id: patientId,
          organization_id: orgId,
          is_deleted: false,
        },
        include: { episodes: { include: { visits: true } } },
        orderBy: { created_at: 'asc' },
      }),
      db.patientObgynHistory.findFirst({ where: { patient_id: patientId } }),
      db.patientConsent.findMany({
        where: {
          patient_id: patientId,
          organization_id: orgId,
          is_deleted: false,
        },
        orderBy: { created_at: 'desc' },
      }),
    ]);

    // The export is a PHI read; record it (non-blocking).
    void this.phiAudit
      .record({
        actorType: 'STAFF',
        userId: user.userId,
        profileId: user.profileId,
        organizationId: orgId,
        subjectType: 'PATIENT',
        subjectId: patientId,
        patientId,
        resource: 'patient.export',
        route: 'POST /v1/patients/:patientId/export',
        purpose: 'operations',
      })
      .catch((err: unknown) => {
        this.logger.error({ message: 'export PHI audit write failed', err });
      });

    return {
      generated_at: new Date(),
      organization_id: orgId,
      patient,
      journeys,
      obgyn_history: obgynHistory,
      consents,
    };
  }
}
