import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import {
  DEFAULT_PRESCRIPTION_LAYOUT,
  DEFAULT_PRESCRIPTION_TEMPLATE_NAME,
  type PrescriptionTemplateLayout,
} from './prescription-template.constants.js';
import {
  PrescriptionDocumentDto,
  PrescriptionPrintDto,
  PrescriptionTemplateDto,
} from './dto/prescription-print.dto.js';

const PRESCRIPTION_PRINT_INCLUDE = {
  items: {
    where: { is_deleted: false },
    orderBy: { order: 'asc' },
    include: { medication: true },
  },
  prescribed_by: {
    include: {
      user: true,
      specialty_links: { include: { specialty: true } },
    },
  },
  visit: {
    include: {
      encounter: true,
      // Visit has no direct patient relation — reach it via episode → journey.
      episode: { include: { journey: { include: { patient: true } } } },
      branch: { include: { organization: true } },
    },
  },
} as const satisfies Prisma.PrescriptionInclude;

@Injectable()
export class PrescriptionsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  /**
   * Printable aggregate for a visit's prescription, plus the resolved layout
   * template. 404 when the visit has no prescription (completed with no meds) —
   * the frontend treats that as "nothing to print".
   */
  async print(
    visitId: string,
    user: AuthContext,
  ): Promise<PrescriptionPrintDto> {
    const prescription = await this.prismaService.db.prescription.findFirst({
      where: {
        visit_id: visitId,
        is_deleted: false,
        visit: { branch: { organization_id: user.organizationId } },
      },
      include: PRESCRIPTION_PRINT_INCLUDE,
    });
    if (!prescription) throw new NotFoundException('Prescription not found');

    const { visit } = prescription;
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      user.organizationId,
      visit.branch_id,
    );

    const document = this.toDocument(prescription);
    const template = await this.resolveTemplate(
      user.organizationId,
      visit.branch_id,
      prescription.prescribed_by_id,
    );

    return { template, document };
  }

  /**
   * Most-specific-wins resolution: a profile (doctor) template beats a branch
   * template, beats an organization template, beats the seeded system default.
   * v1 only ever has the system default, but the precedence is in place so the
   * future editor's per-scope templates are honored without code changes.
   */
  private async resolveTemplate(
    organizationId: string,
    branchId: string,
    profileId: string,
  ): Promise<PrescriptionTemplateDto> {
    const candidates =
      await this.prismaService.db.prescriptionTemplate.findMany({
        where: {
          is_deleted: false,
          OR: [
            { profile_id: profileId },
            { branch_id: branchId },
            { organization_id: organizationId },
            { is_system: true },
          ],
        },
      });

    const score = (t: (typeof candidates)[number]): number => {
      if (t.profile_id === profileId) return 3;
      if (t.branch_id === branchId) return 2;
      if (t.organization_id === organizationId) return 1;
      return 0; // is_system default
    };
    const resolved = candidates.sort((a, b) => score(b) - score(a))[0];

    if (resolved) {
      return {
        id: resolved.id,
        name: resolved.name,
        layout: resolved.layout as unknown as PrescriptionTemplateLayout,
      };
    }
    // Defensive fallback if the seed has not run yet — render the built-in default.
    return {
      id: 'system-default',
      name: DEFAULT_PRESCRIPTION_TEMPLATE_NAME,
      layout: DEFAULT_PRESCRIPTION_LAYOUT,
    };
  }

  private toDocument(
    prescription: PrescriptionWithRelations,
  ): PrescriptionDocumentDto {
    const { visit } = prescription;
    const organization = visit.branch.organization;
    const patient = visit.episode.journey.patient;
    const prescriber = prescription.prescribed_by;
    const user = prescriber.user;

    const doctorName = user
      ? `Dr. ${user.first_name} ${user.last_name}`.trim()
      : 'Doctor';
    const specialty =
      prescriber.specialty_links[0]?.specialty?.name ??
      visit.specialty_code ??
      null;

    return {
      prescribed_at: prescription.prescribed_at,
      notes: prescription.notes,
      organization: {
        id: organization.id,
        name: organization.name,
        logo_object_key: organization.logo_object_key,
      },
      branch: {
        id: visit.branch.id,
        name: visit.branch.name,
        address: visit.branch.address,
        city: visit.branch.city,
        governorate: visit.branch.governorate,
        country: visit.branch.country,
      },
      doctor: {
        id: prescriber.id,
        name: doctorName,
        specialty,
        license_number: null,
        signature_object_key: null,
      },
      patient: {
        id: patient.id,
        full_name: patient.full_name,
        phone_number: patient.phone_number,
        date_of_birth: patient.date_of_birth,
      },
      diagnosis: {
        chief_complaint: visit.encounter?.chief_complaint ?? null,
        provisional_diagnosis: visit.encounter?.provisional_diagnosis ?? null,
      },
      items: prescription.items.map((item) => ({
        name: item.medication?.name ?? item.custom_drug_name ?? 'Unknown',
        generic_name: item.medication?.generic_name ?? null,
        strength: item.medication?.strength ?? null,
        form: item.medication?.form ?? null,
        dose: item.dose,
        route: item.route,
        frequency: item.frequency,
        duration: item.duration,
        instructions: item.instructions,
      })),
    };
  }
}

// Derived from the include above so the row type can never drift from the query.
type PrescriptionWithRelations = Prisma.PrescriptionGetPayload<{
  include: typeof PRESCRIPTION_PRINT_INCLUDE;
}>;
