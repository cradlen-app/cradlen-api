import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { AuthContext } from '@common/interfaces/auth-context.interface';

/**
 * Org + branch scoping access gates for patient + visit lookups, shared across
 * the Patients module and the OB/GYN specialty.
 *
 * Org-level access is granted iff the caller's organization owns the relevant
 * `PatientJourney`. Branch-gated access (for non-OWNERs) additionally requires
 * the patient to have a visit at a branch the caller is assigned to that is
 * either scheduled or has been checked in — the patient record is org-scoped,
 * but branch staff only reach patients they've booked or seen. All checks throw
 * `404 NotFound` (not `403`) to avoid leaking entity existence across
 * orgs/branches.
 */
@Injectable()
export class PatientAccessService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  /**
   * Branch-gated patient access. OWNER reaches any patient in the org;
   * BRANCH_MANAGER/STAFF reach a patient only if they have a scheduled or
   * checked-in visit at a branch the caller is assigned to. Use this for
   * record-level reads (detail, history) and writes; use
   * {@link assertPatientInOrg} only where org-level visibility is intentional
   * (e.g. booking identity lookup).
   */
  async assertPatientAccessible(patientId: string, user: AuthContext) {
    if (
      await this.authorizationService.isOwner(
        user.profileId,
        user.organizationId,
      )
    ) {
      return this.assertPatientInOrg(patientId, user);
    }

    const branchIds = await this.authorizationService.getEffectiveBranchIds(
      user.profileId,
      user.organizationId,
    );

    const patient = branchIds.length
      ? await this.prismaService.db.patient.findFirst({
          where: {
            id: patientId,
            is_deleted: false,
            journeys: {
              some: {
                organization_id: user.organizationId,
                is_deleted: false,
                episodes: {
                  some: {
                    is_deleted: false,
                    visits: {
                      some: {
                        branch_id: { in: branchIds },
                        is_deleted: false,
                        OR: [
                          { checked_in_at: { not: null } },
                          { status: 'SCHEDULED' },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
          select: { id: true },
        })
      : null;

    if (!patient) {
      throw new NotFoundException(`Patient ${patientId} not found`);
    }
  }

  async assertPatientInOrg(patientId: string, user: AuthContext) {
    const patient = await this.prismaService.db.patient.findFirst({
      where: {
        id: patientId,
        is_deleted: false,
        journeys: {
          some: {
            organization_id: user.organizationId,
            is_deleted: false,
          },
        },
      },
      select: { id: true },
    });
    if (!patient) {
      throw new NotFoundException(`Patient ${patientId} not found`);
    }
  }

  async assertVisitInOrg(visitId: string, user: AuthContext) {
    const visit = await this.prismaService.db.visit.findFirst({
      where: {
        id: visitId,
        is_deleted: false,
        episode: {
          journey: {
            organization_id: user.organizationId,
            is_deleted: false,
          },
        },
      },
      select: { id: true, status: true },
    });
    if (!visit) {
      throw new NotFoundException(`Visit ${visitId} not found`);
    }
    return visit;
  }
}
