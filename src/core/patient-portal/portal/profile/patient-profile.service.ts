import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { StorageService } from '@infrastructure/storage/storage.service.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { resolveAccessiblePatientIds } from '../accessible-patients.util.js';
import {
  PatientProfileDto,
  UpdatePatientProfileDto,
} from './dto/patient-profile.dto.js';
import {
  ConfirmProfileImageDto,
  ProfileImageUploadDto,
  ProfileImageUploadUrlDto,
} from './dto/profile-image.dto.js';

/** Prisma selection for a patient-profile row (demographics + avatar). */
const patientProfileSelect = {
  id: true,
  full_name: true,
  national_id: true,
  date_of_birth: true,
  phone_number: true,
  address: true,
  marital_status: true,
  profile_image_object_key: true,
} satisfies Prisma.PatientSelect;

type PatientProfileRow = Prisma.PatientGetPayload<{
  select: typeof patientProfileSelect;
}>;

/**
 * Patient-facing profile settings: a logged-in patient (or a guardian acting for
 * a linked patient) reads/updates demographics and manages a profile image.
 * The target patient is resolved through `resolveAccessiblePatientIds`, so a
 * caller can only ever touch a record they may access (generic 404 otherwise).
 */
@Injectable()
export class PatientProfileService {
  private readonly logger = new Logger(PatientProfileService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  /** Object-key prefix that scopes an avatar to one patient. */
  private avatarPrefix(patientId: string): string {
    return `patients/${patientId}/avatar/`;
  }

  /**
   * Resolves the single patient this request targets. A patient account resolves
   * to its own record; a guardian must disambiguate with `patient_id` when they
   * manage more than one patient.
   */
  private resolveSinglePatientId(
    ctx: PatientAuthContext,
    patientId?: string,
  ): string {
    const ids = resolveAccessiblePatientIds(ctx, patientId);
    if (ids.length === 0) {
      throw new NotFoundException('No matching record found');
    }
    if (ids.length > 1) {
      throw new BadRequestException('patient_id is required');
    }
    return ids[0];
  }

  /** Loads the scoped patient row, or throws a generic 404. */
  private async loadPatient(
    ctx: PatientAuthContext,
    patientId?: string,
  ): Promise<PatientProfileRow> {
    const targetId = this.resolveSinglePatientId(ctx, patientId);
    const patient = await this.prismaService.db.patient.findFirst({
      where: { id: targetId, is_deleted: false },
      select: patientProfileSelect,
    });
    if (!patient) {
      throw new NotFoundException('No matching record found');
    }
    return patient;
  }

  async getProfile(
    ctx: PatientAuthContext,
    patientId?: string,
  ): Promise<PatientProfileDto> {
    const patient = await this.loadPatient(ctx, patientId);
    return this.toDto(patient);
  }

  /**
   * Updates the patient's demographics (spread-guard — only supplied fields).
   * The portal login (PatientAccount) holds no demographics, so there is nothing
   * to keep in sync — name/phone live solely on the Patient row.
   */
  async updateProfile(
    ctx: PatientAuthContext,
    patientId: string | undefined,
    dto: UpdatePatientProfileDto,
  ): Promise<PatientProfileDto> {
    const patient = await this.loadPatient(ctx, patientId);

    const patientData: Prisma.PatientUpdateInput = {
      ...(dto.full_name !== undefined && { full_name: dto.full_name }),
      ...(dto.date_of_birth !== undefined && {
        date_of_birth: new Date(dto.date_of_birth),
      }),
      ...(dto.phone_number !== undefined && { phone_number: dto.phone_number }),
      ...(dto.address !== undefined && { address: dto.address }),
      ...(dto.marital_status !== undefined && {
        marital_status: dto.marital_status,
      }),
    };

    const updated = await this.prismaService.db.patient.update({
      where: { id: patient.id },
      data: patientData,
      select: patientProfileSelect,
    });

    return this.toDto(updated);
  }

  /**
   * Issues a short-lived presigned PUT URL for an avatar. Images only; the key is
   * server-derived and scoped to the patient.
   */
  async createImageUploadUrl(
    ctx: PatientAuthContext,
    patientId: string | undefined,
    dto: ProfileImageUploadDto,
  ): Promise<ProfileImageUploadUrlDto> {
    const targetId = this.resolveSinglePatientId(ctx, patientId);

    this.assertImageContentType(dto.content_type);
    this.storageService.assertAllowedContentType(dto.content_type);
    this.storageService.assertWithinSizeLimit(dto.size_bytes);

    const ext = this.storageService.extensionFor(dto.content_type);
    const key = `${this.avatarPrefix(targetId)}${randomUUID()}.${ext}`;

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
   * Confirms an uploaded avatar: validates the key belongs to this patient and
   * the object actually landed in R2, sets it on the patient, and best-effort
   * removes the previously stored image.
   */
  async confirmImage(
    ctx: PatientAuthContext,
    patientId: string | undefined,
    dto: ConfirmProfileImageDto,
  ): Promise<PatientProfileDto> {
    const patient = await this.loadPatient(ctx, patientId);

    if (!dto.key.startsWith(this.avatarPrefix(patient.id))) {
      throw new BadRequestException('Invalid image key');
    }

    const head = await this.storageService.headObject(dto.key);
    if (!head) {
      throw new BadRequestException('Uploaded file not found');
    }
    if (head.contentType) {
      this.assertImageContentType(head.contentType);
      this.storageService.assertAllowedContentType(head.contentType);
    }
    if (typeof head.contentLength === 'number') {
      this.storageService.assertWithinSizeLimit(head.contentLength);
    }

    const previousKey = patient.profile_image_object_key;

    const updated = await this.prismaService.db.patient.update({
      where: { id: patient.id },
      data: { profile_image_object_key: dto.key },
      select: patientProfileSelect,
    });

    if (previousKey && previousKey !== dto.key) {
      await this.bestEffortDelete(previousKey);
    }

    return this.toDto(updated);
  }

  /** Clears the patient's avatar and best-effort removes the R2 object. */
  async removeImage(
    ctx: PatientAuthContext,
    patientId?: string,
  ): Promise<PatientProfileDto> {
    const patient = await this.loadPatient(ctx, patientId);
    const previousKey = patient.profile_image_object_key;

    const updated = await this.prismaService.db.patient.update({
      where: { id: patient.id },
      data: { profile_image_object_key: null },
      select: patientProfileSelect,
    });

    if (previousKey) {
      await this.bestEffortDelete(previousKey);
    }

    return this.toDto(updated);
  }

  private assertImageContentType(contentType: string): void {
    if (!contentType.startsWith('image/')) {
      throw new BadRequestException('Profile image must be an image file');
    }
  }

  private async bestEffortDelete(key: string): Promise<void> {
    try {
      await this.storageService.deleteObject(key);
    } catch {
      this.logger.warn(`Failed to delete previous avatar object ${key}`);
    }
  }

  private async toDto(patient: PatientProfileRow): Promise<PatientProfileDto> {
    const profile_image_url = patient.profile_image_object_key
      ? await this.storageService.createPresignedDownloadUrl(
          patient.profile_image_object_key,
        )
      : null;

    return {
      id: patient.id,
      full_name: patient.full_name,
      national_id: patient.national_id,
      date_of_birth: patient.date_of_birth,
      phone_number: patient.phone_number,
      address: patient.address,
      marital_status: patient.marital_status,
      profile_image_url,
    };
  }
}
