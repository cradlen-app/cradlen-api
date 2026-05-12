import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';

/**
 * Cross-org patient lookup gate for the OB/GYN specialty.
 *
 * A caller's organization has access to a patient iff it has at least one
 * `PatientJourney` for that patient (any status, soft-delete excluded).
 * Mirrors the core `patient-history` module's `PatientAccessService` —
 * intentionally copied rather than imported to keep the specialty self-contained
 * and to respect the `specialties → core via *.module.ts | *.public.ts` boundary.
 *
 * Throws `404 NotFound` (not `403 Forbidden`) to avoid leaking patient existence
 * across organizations.
 */
@Injectable()
export class ObgynPatientAccessService {
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

  async assertJourneyInOrg(journeyId: string, user: AuthContext) {
    const journey = await this.prismaService.db.patientJourney.findFirst({
      where: {
        id: journeyId,
        is_deleted: false,
        organization_id: user.organizationId,
      },
      select: {
        id: true,
        care_path: { select: { code: true } },
      },
    });
    if (!journey) {
      throw new NotFoundException(`Journey ${journeyId} not found`);
    }
    return journey;
  }

  async assertEpisodeInOrg(episodeId: string, user: AuthContext) {
    const episode = await this.prismaService.db.patientEpisode.findFirst({
      where: {
        id: episodeId,
        is_deleted: false,
        journey: {
          organization_id: user.organizationId,
          is_deleted: false,
        },
      },
      select: {
        id: true,
        journey: {
          select: {
            id: true,
            care_path: { select: { code: true } },
          },
        },
      },
    });
    if (!episode) {
      throw new NotFoundException(`Episode ${episodeId} not found`);
    }
    return episode;
  }
}
