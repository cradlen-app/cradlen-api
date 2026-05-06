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

  async findAll(query: ListPatientsQueryDto, user: AuthContext) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const isClinicianRole =
      user.roles.includes('DOCTOR') || user.roles.includes('OWNER');

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
        include: {
          journeys: {
            where: {
              organization_id: user.organizationId,
              status: 'ACTIVE',
              is_deleted: false,
            },
            take: 1,
            include: {
              episodes: {
                where: { is_deleted: false },
                orderBy: { order: 'asc' },
              },
            },
          },
        },
      }),
      this.prismaService.db.patient.count({ where }),
    ]);

    const shaped = patients.map((patient) => {
      const { journeys, ...rest } = patient;
      const activeJourney = journeys[0] ?? null;
      if (isClinicianRole) {
        return { ...rest, active_journey: activeJourney };
      }
      return {
        ...rest,
        active_episodes: activeJourney
          ? activeJourney.episodes.map((e) => ({
              id: e.id,
              name: e.name,
              order: e.order,
            }))
          : [],
      };
    });

    return paginated(shaped, { page, limit, total });
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
