import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { StorageService } from '@infrastructure/storage/storage.service.js';
import { AdminAuditService } from '@core/platform-admin/audit/admin-audit.service.js';
import {
  AnonymizePatientDto,
  AnonymizeResultDto,
} from './dto/anonymize-patient.dto.js';

/**
 * Platform-admin patient anonymization (right-to-erasure), executed on a
 * controller's documented instruction. Last-org-standing: the requesting org's
 * data (journeys, enrollment, consents) is soft-deleted; the shared master
 * identity is scrubbed only when NO other organization still holds the patient.
 * The whole operation + its AdminAuditLog row commit in one transaction. Avatar
 * deletion (non-transactional storage) is best-effort after commit. The audit
 * row deliberately stores NO raw identifiers — that would defeat the erasure.
 */
@Injectable()
export class ErasureService {
  private readonly logger = new Logger(ErasureService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly storage: StorageService,
  ) {}

  async anonymizePatient(
    adminId: string,
    patientId: string,
    dto: AnonymizePatientDto,
  ): Promise<AnonymizeResultDto> {
    const result = await this.prismaService.db.$transaction(async (tx) => {
      const patient = await tx.patient.findFirst({
        where: { id: patientId },
        select: { id: true, is_deleted: true, profile_image_object_key: true },
      });
      if (!patient) {
        throw new NotFoundException(`Patient ${patientId} not found`);
      }

      const now = new Date();

      // Remove the requesting org's data (its access is gated on non-deleted
      // journeys — see PatientAccessService.assertPatientInOrg).
      await tx.patientJourney.updateMany({
        where: {
          patient_id: patientId,
          organization_id: dto.organization_id,
          is_deleted: false,
        },
        data: { is_deleted: true, deleted_at: now },
      });
      await tx.patientOrgEnrollment.updateMany({
        where: {
          patient_id: patientId,
          organization_id: dto.organization_id,
          is_deleted: false,
        },
        data: { is_deleted: true, deleted_at: now },
      });
      await tx.patientConsent.updateMany({
        where: {
          patient_id: patientId,
          organization_id: dto.organization_id,
          is_deleted: false,
        },
        data: { is_deleted: true, deleted_at: now },
      });

      // Last-org-standing: does any OTHER org still hold this patient?
      const [remainingJourneys, remainingEnrollments] = await Promise.all([
        tx.patientJourney.count({
          where: { patient_id: patientId, is_deleted: false },
        }),
        tx.patientOrgEnrollment.count({
          where: { patient_id: patientId, is_deleted: false },
        }),
      ]);
      const otherOrgsRemain = remainingJourneys > 0 || remainingEnrollments > 0;

      let masterAnonymized = false;
      let avatarKey: string | null = null;

      if (!otherOrgsRemain) {
        avatarKey = patient.profile_image_object_key;
        await tx.patient.update({
          where: { id: patientId },
          data: {
            national_id: `ANON-${patientId}`,
            full_name: 'Redacted Patient',
            phone_number: 'REDACTED',
            address: 'REDACTED',
            profile_image_object_key: null,
            is_deleted: true,
            deleted_at: now,
          },
        });
        // Disable + tombstone the portal login, if any.
        await tx.patientAccount.updateMany({
          where: { patient_id: patientId, is_deleted: false },
          data: { is_active: false, is_deleted: true, deleted_at: now },
        });
        masterAnonymized = true;
      }

      // Audit — NO raw identifiers, only outcome metadata.
      await this.audit.record(
        {
          adminId,
          action: 'patient.anonymize',
          targetType: 'Patient',
          targetId: patientId,
          before: { was_deleted: patient.is_deleted },
          after: {
            master_anonymized: masterAnonymized,
            requesting_org: dto.organization_id,
            other_orgs_remain: otherOrgsRemain,
            reason: dto.reason,
          },
        },
        tx,
      );

      return { masterAnonymized, otherOrgsRemain, avatarKey };
    });

    if (result.masterAnonymized && result.avatarKey) {
      try {
        await this.storage.deleteObject(result.avatarKey);
      } catch (err: unknown) {
        this.logger.error({ message: 'avatar delete on erasure failed', err });
      }
    }

    return {
      patient_id: patientId,
      master_anonymized: result.masterAnonymized,
      other_orgs_remain: result.otherOrgsRemain,
    };
  }
}
