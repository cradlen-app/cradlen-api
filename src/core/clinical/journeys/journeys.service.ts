import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.public';
import { JourneyDescriptorDto } from './dto/journey-descriptor.dto';

/**
 * Read-only resolver for the journey a visit belongs to, plus the clinical
 * surface its care path declares. Backs the dynamic "journey" tab in the visit
 * workspace. (The old journeys CRUD module was removed; this is intentionally
 * a thin read surface.)
 */
@Injectable()
export class JourneysService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly access: PatientAccessService,
  ) {}

  /**
   * The journey descriptor for a visit's workspace. Resolves the visit's own
   * episode → journey (for a live visit this is the patient's single active
   * journey) and folds in the care path's `CarePathClinicalSurface`, if any.
   * Returns `null` when the visit has no journey.
   */
  async getActiveJourneyForVisit(
    visitId: string,
    user: AuthContext,
  ): Promise<JourneyDescriptorDto | null> {
    await this.access.assertVisitInOrg(visitId, user);

    const visit = await this.prismaService.db.visit.findFirst({
      where: { id: visitId, is_deleted: false },
      select: {
        episode: {
          select: {
            id: true,
            journey: {
              select: {
                id: true,
                status: true,
                started_at: true,
                ended_at: true,
                care_path: {
                  select: {
                    code: true,
                    name: true,
                    specialty: { select: { code: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    const episode = visit?.episode;
    const journey = episode?.journey;
    if (!episode || !journey) return null;

    const carePathCode = journey.care_path?.code ?? null;
    const specialtyCode = journey.care_path?.specialty?.code ?? null;

    const surface =
      carePathCode && specialtyCode
        ? await this.prismaService.db.carePathClinicalSurface.findFirst({
            where: {
              specialty_code: specialtyCode,
              care_path_code: carePathCode,
              is_deleted: false,
            },
            orderBy: { order: 'asc' },
            select: { template_code: true, label: true },
          })
        : null;

    return {
      journey_id: journey.id,
      episode_id: episode.id,
      care_path_code: carePathCode,
      specialty_code: specialtyCode,
      label: journey.care_path?.name ?? null,
      status: journey.status,
      started_at: journey.started_at,
      ended_at: journey.ended_at,
      clinical_surface: surface
        ? { template_code: surface.template_code, label: surface.label }
        : null,
    };
  }
}
