import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PatientConsent } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.public.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import {
  COMPLIANCE_EVENTS,
  type ConsentEventPayload,
} from './compliance-events.js';
import {
  ConsentResponseDto,
  GrantConsentDto,
  WithdrawConsentDto,
} from './dto/consent.dto.js';

/**
 * Controller-side consent tooling: clinic staff record and withdraw a patient's
 * treatment / data-processing / communications consent, versioned to the
 * presented consent text. Org-scoped and gated by `assertPatientInOrg` (the
 * patient must be enrolled in the caller's organization). History is preserved —
 * each grant is a new row; withdrawal flips a specific row to WITHDRAWN.
 */
@Injectable()
export class ConsentService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly patientAccess: PatientAccessService,
    private readonly eventBus: EventBus,
  ) {}

  async grant(
    patientId: string,
    dto: GrantConsentDto,
    user: AuthContext,
  ): Promise<ConsentResponseDto> {
    await this.patientAccess.assertPatientInOrg(patientId, user);

    const row = await this.prismaService.db.patientConsent.create({
      data: {
        patient_id: patientId,
        organization_id: user.organizationId,
        type: dto.type,
        status: 'GRANTED',
        consent_version: dto.consent_version,
        captured_by_id: user.profileId,
        note: dto.note ?? null,
      },
    });

    this.publish(COMPLIANCE_EVENTS.CONSENT_GRANTED, row, user);
    return this.toDto(row);
  }

  async withdraw(
    patientId: string,
    consentId: string,
    dto: WithdrawConsentDto,
    user: AuthContext,
  ): Promise<ConsentResponseDto> {
    await this.patientAccess.assertPatientInOrg(patientId, user);

    const existing = await this.prismaService.db.patientConsent.findFirst({
      where: {
        id: consentId,
        patient_id: patientId,
        organization_id: user.organizationId,
        is_deleted: false,
      },
    });
    if (!existing) {
      throw new NotFoundException(`Consent ${consentId} not found`);
    }
    if (existing.status === 'WITHDRAWN') {
      throw new ConflictException('Consent is already withdrawn');
    }

    const row = await this.prismaService.db.patientConsent.update({
      where: { id: consentId },
      data: {
        status: 'WITHDRAWN',
        withdrawn_at: new Date(),
        withdrawn_by_id: user.profileId,
        ...(dto.note ? { note: dto.note } : {}),
      },
    });

    this.publish(COMPLIANCE_EVENTS.CONSENT_WITHDRAWN, row, user);
    return this.toDto(row);
  }

  async list(
    patientId: string,
    user: AuthContext,
  ): Promise<ConsentResponseDto[]> {
    await this.patientAccess.assertPatientInOrg(patientId, user);

    const rows = await this.prismaService.db.patientConsent.findMany({
      where: {
        patient_id: patientId,
        organization_id: user.organizationId,
        is_deleted: false,
      },
      orderBy: { created_at: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  private publish(
    event: (typeof COMPLIANCE_EVENTS)[keyof typeof COMPLIANCE_EVENTS],
    row: PatientConsent,
    user: AuthContext,
  ): void {
    const payload: ConsentEventPayload = {
      consentId: row.id,
      patientId: row.patient_id,
      organizationId: row.organization_id,
      type: row.type,
      capturedById: user.profileId,
    };
    this.eventBus.publish(event, payload);
  }

  private toDto(row: PatientConsent): ConsentResponseDto {
    return {
      id: row.id,
      patient_id: row.patient_id,
      organization_id: row.organization_id,
      type: row.type,
      status: row.status,
      consent_version: row.consent_version,
      captured_by_id: row.captured_by_id,
      granted_at: row.granted_at,
      withdrawn_at: row.withdrawn_at,
      withdrawn_by_id: row.withdrawn_by_id,
      note: row.note,
      created_at: row.created_at,
    };
  }
}
