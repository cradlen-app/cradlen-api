import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { ListPatientsQueryDto } from './dto/list-patients-query.dto';
import { paginated } from '../../common/utils/pagination.utils';

@Injectable()
export class PatientsService {
  constructor(private readonly prismaService: PrismaService) {}

  async create(dto: CreatePatientDto) {
    return this.prismaService.db.patient.create({
      data: {
        full_name: dto.full_name,
        husband_name: dto.husband_name ?? null,
        date_of_birth: new Date(dto.date_of_birth),
        national_id: dto.national_id,
        phone_number: dto.phone_number,
        address: dto.address,
      },
    });
  }

  async findAll(query: ListPatientsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      is_deleted: false,
      ...(query.search
        ? {
            OR: [
              {
                full_name: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
              { national_id: { contains: query.search } },
              { phone_number: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [patients, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.patient.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prismaService.db.patient.count({ where }),
    ]);
    return paginated(patients, { page, limit, total });
  }

  async lookup(nationalId: string, user: AuthContext) {
    const patient = await this.prismaService.db.patient.findUnique({
      where: { national_id: nationalId, is_deleted: false },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    const isClinicianRole =
      user.roles.includes('DOCTOR') || user.roles.includes('OWNER');

    const activeJourney = await this.prismaService.db.patientJourney.findFirst({
      where: {
        patient_id: patient.id,
        organization_id: user.organizationId,
        status: 'ACTIVE',
        is_deleted: false,
      },
    });

    if (isClinicianRole && activeJourney) {
      const episodes = await this.prismaService.db.patientEpisode.findMany({
        where: { journey_id: activeJourney.id, is_deleted: false },
        orderBy: { order: 'asc' },
      });
      return { ...patient, active_journey: { ...activeJourney, episodes } };
    }

    const activeEpisodes = activeJourney
      ? await this.prismaService.db.patientEpisode.findMany({
          where: { journey_id: activeJourney.id, is_deleted: false },
          select: { id: true, name: true, order: true },
          orderBy: { order: 'asc' },
        })
      : [];

    return { ...patient, active_episodes: activeEpisodes };
  }

  async findOne(id: string) {
    const patient = await this.prismaService.db.patient.findUnique({
      where: { id, is_deleted: false },
    });
    if (!patient) throw new NotFoundException(`Patient ${id} not found`);
    return patient;
  }

  async update(id: string, dto: UpdatePatientDto) {
    await this.findOne(id);
    return this.prismaService.db.patient.update({
      where: { id },
      data: {
        ...(dto.full_name !== undefined && { full_name: dto.full_name }),
        ...(dto.husband_name !== undefined && {
          husband_name: dto.husband_name,
        }),
        ...(dto.date_of_birth !== undefined && {
          date_of_birth: new Date(dto.date_of_birth),
        }),
        ...(dto.phone_number !== undefined && {
          phone_number: dto.phone_number,
        }),
        ...(dto.address !== undefined && { address: dto.address }),
      },
    });
  }
}
