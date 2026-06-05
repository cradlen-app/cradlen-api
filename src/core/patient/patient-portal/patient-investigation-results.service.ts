import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { StorageService } from '@infrastructure/storage/storage.service.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { resolveAccessiblePatientIds } from './accessible-patients.util.js';
import {
  patientInvestigationInclude,
  mapPatientInvestigation,
} from './patient-investigations.service.js';
import { PatientInvestigationItemDto } from './dto/patient-investigation.dto.js';
import {
  ConfirmResultDto,
  CreateResultUploadDto,
  ResultUploadUrlDto,
} from './dto/investigation-result.dto.js';

/**
 * Patient-uploaded investigation results. The patient uploads a result file
 * (PDF/image) for an investigation ordered for them, directly to R2 via a
 * presigned PUT, then confirms the object key. Provenance is `result_source =
 * PATIENT` (a patient is not a Profile, so `resulted_by_id` stays null).
 */
@Injectable()
export class PatientInvestigationResultsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  /** Object-key prefix that scopes a result file to one investigation. */
  private resultPrefix(investigationId: string): string {
    return `investigations/${investigationId}/results/`;
  }

  /**
   * Loads an investigation the caller may access (cross-org via the patient's
   * journeys), or throws a generic 404 — never reveal another patient's record.
   */
  private async assertAccessibleInvestigation(
    ctx: PatientAuthContext,
    investigationId: string,
  ): Promise<{ id: string; status: string }> {
    const targetIds = resolveAccessiblePatientIds(ctx);
    if (targetIds.length === 0) {
      throw new NotFoundException('No matching record found');
    }

    const investigation =
      await this.prismaService.db.visitInvestigation.findFirst({
        where: {
          id: investigationId,
          is_deleted: false,
          visit: {
            is_deleted: false,
            episode: { journey: { patient_id: { in: targetIds } } },
          },
        },
        select: { id: true, status: true },
      });

    if (!investigation) {
      throw new NotFoundException('No matching record found');
    }
    return investigation;
  }

  /**
   * Issues a short-lived presigned PUT URL for a result file. The key is
   * server-derived and scoped to the investigation; the caller uploads the bytes
   * directly to R2, then calls `confirmResult` with the returned key.
   */
  async createUploadUrl(
    ctx: PatientAuthContext,
    investigationId: string,
    dto: CreateResultUploadDto,
  ): Promise<ResultUploadUrlDto> {
    await this.assertAccessibleInvestigation(ctx, investigationId);

    this.storageService.assertAllowedContentType(dto.content_type);
    this.storageService.assertWithinSizeLimit(dto.size_bytes);

    const ext = this.storageService.extensionFor(dto.content_type);
    const key = `${this.resultPrefix(investigationId)}${randomUUID()}.${ext}`;

    const { url, expiresIn } =
      await this.storageService.createPresignedUploadUrl({
        key,
        contentType: dto.content_type,
      });

    return {
      key,
      upload_url: url,
      expires_in: expiresIn,
      content_type: dto.content_type,
    };
  }

  /**
   * Confirms an uploaded result: validates the key belongs to this investigation
   * and the object actually landed in R2, then records it on the investigation
   * (RESULTED, patient-sourced) inside a transaction.
   */
  async confirmResult(
    ctx: PatientAuthContext,
    investigationId: string,
    dto: ConfirmResultDto,
  ): Promise<PatientInvestigationItemDto> {
    const existing = await this.assertAccessibleInvestigation(
      ctx,
      investigationId,
    );

    // Security: the key must be one we issued for THIS investigation, so a
    // patient can't point their record at an arbitrary or someone else's object.
    if (!dto.key.startsWith(this.resultPrefix(investigationId))) {
      throw new BadRequestException('Invalid result key');
    }

    const head = await this.storageService.headObject(dto.key);
    if (!head) {
      throw new BadRequestException('Uploaded file not found');
    }
    if (head.contentType) {
      this.storageService.assertAllowedContentType(head.contentType);
    }
    if (typeof head.contentLength === 'number') {
      this.storageService.assertWithinSizeLimit(head.contentLength);
    }

    // Advance ORDERED → RESULTED; never downgrade a REVIEWED/CANCELLED row.
    const nextStatus = existing.status === 'ORDERED' ? 'RESULTED' : undefined;

    const updated = await this.prismaService.db.visitInvestigation.update({
      where: { id: investigationId },
      data: {
        result_attachment_url: dto.key,
        result_source: 'PATIENT',
        resulted_at: new Date(),
        ...(dto.result_text !== undefined
          ? { result_text: dto.result_text }
          : {}),
        ...(nextStatus ? { status: nextStatus } : {}),
        version: { increment: 1 },
      },
      include: patientInvestigationInclude,
    });

    return mapPatientInvestigation(updated, this.storageService);
  }
}
