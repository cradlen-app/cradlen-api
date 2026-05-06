import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CreateJourneyDto } from './dto/create-journey.dto';
import { UpdateJourneyStatusDto } from './dto/update-journey-status.dto';
import { UpdateEpisodeStatusDto } from './dto/update-episode-status.dto';
import { paginated } from '../../common/utils/pagination.utils';

@Injectable()
export class JourneysService {
  constructor(private readonly prismaService: PrismaService) {}

  async create(patientId: string, dto: CreateJourneyDto, user: AuthContext) {
    const patient = await this.prismaService.db.patient.findUnique({
      where: { id: patientId, is_deleted: false },
    });
    if (!patient) throw new NotFoundException(`Patient ${patientId} not found`);

    const existingActive = await this.prismaService.db.patientJourney.findFirst(
      {
        where: {
          patient_id: patientId,
          organization_id: user.organizationId,
          journey_template_id: dto.journey_template_id,
          status: 'ACTIVE',
          is_deleted: false,
        },
      },
    );
    if (existingActive) {
      throw new ConflictException(
        'Patient already has an active journey of this type',
      );
    }

    const template = await this.prismaService.db.journeyTemplate.findUnique({
      where: { id: dto.journey_template_id, is_deleted: false },
      include: {
        episodes: { where: { is_deleted: false }, orderBy: { order: 'asc' } },
      },
    });
    if (!template)
      throw new NotFoundException(
        `Journey template ${dto.journey_template_id} not found`,
      );

    return this.prismaService.db.$transaction(async (tx) => {
      const journey = await tx.patientJourney.create({
        data: {
          patient_id: patientId,
          organization_id: user.organizationId,
          journey_template_id: dto.journey_template_id,
          created_by_id: user.profileId,
          status: 'ACTIVE',
        },
      });

      const now = new Date();
      await tx.patientEpisode.createMany({
        data: template.episodes.map((ep, index) => ({
          journey_id: journey.id,
          episode_template_id: ep.id,
          name: ep.name,
          order: ep.order,
          status: index === 0 ? 'ACTIVE' : 'PENDING',
          started_at: index === 0 ? now : null,
        })),
      });

      return tx.patientJourney.findUnique({
        where: { id: journey.id },
        include: {
          episodes: { where: { is_deleted: false }, orderBy: { order: 'asc' } },
        },
      });
    });
  }

  async findAllForPatient(
    patientId: string,
    user: AuthContext,
    query: { page?: number; limit?: number },
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      patient_id: patientId,
      organization_id: user.organizationId,
      is_deleted: false,
    };
    const [journeys, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.patientJourney.findMany({
        where,
        include: {
          episodes: { where: { is_deleted: false }, orderBy: { order: 'asc' } },
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaService.db.patientJourney.count({ where }),
    ]);
    return paginated(journeys, { page, limit, total });
  }

  async findOne(id: string, user: AuthContext) {
    const journey = await this.prismaService.db.patientJourney.findUnique({
      where: { id, is_deleted: false },
      include: {
        episodes: { where: { is_deleted: false }, orderBy: { order: 'asc' } },
      },
    });
    if (!journey || journey.organization_id !== user.organizationId) {
      throw new NotFoundException(`Journey ${id} not found`);
    }
    return journey;
  }

  async updateStatus(
    id: string,
    dto: UpdateJourneyStatusDto,
    user: AuthContext,
  ) {
    await this.findOne(id, user);
    return this.prismaService.db.patientJourney.update({
      where: { id },
      data: { status: dto.status, ended_at: new Date() },
      include: {
        episodes: { where: { is_deleted: false }, orderBy: { order: 'asc' } },
      },
    });
  }

  async updateEpisodeStatus(
    journeyId: string,
    episodeId: string,
    dto: UpdateEpisodeStatusDto,
    user: AuthContext,
  ) {
    await this.findOne(journeyId, user);

    const episode = await this.prismaService.db.patientEpisode.findUnique({
      where: { id: episodeId, is_deleted: false },
    });
    if (!episode || episode.journey_id !== journeyId) {
      throw new NotFoundException(`Episode ${episodeId} not found`);
    }

    if (dto.status === 'ACTIVE') {
      const anotherActive =
        await this.prismaService.db.patientJourney.findFirst({
          where: {
            id: journeyId,
            episodes: {
              some: {
                status: 'ACTIVE',
                id: { not: episodeId },
                is_deleted: false,
              },
            },
          },
        });
      if (anotherActive) {
        throw new ForbiddenException(
          'Complete the current active episode before activating another',
        );
      }
    }

    await this.prismaService.db.patientEpisode.update({
      where: { id: episodeId },
      data: {
        status: dto.status,
        started_at: dto.status === 'ACTIVE' ? new Date() : undefined,
        ended_at: dto.status === 'COMPLETED' ? new Date() : undefined,
      },
    });

    return this.findOne(journeyId, user);
  }
}
