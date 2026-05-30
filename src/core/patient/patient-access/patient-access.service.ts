import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';

/**
 * Org-scoping access gates for patient + visit lookups, shared across the
 * Patients module and the OB/GYN specialty.
 *
 * Access is granted iff the caller's organization owns the relevant
 * `PatientJourney` (any status, soft-delete excluded). All checks throw
 * `404 NotFound` (not `403`) to avoid leaking entity existence across orgs.
 */
@Injectable()
export class PatientAccessService {
  constructor(private readonly prismaService: PrismaService) {}

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
