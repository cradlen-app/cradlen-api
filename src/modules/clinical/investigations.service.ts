import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvestigationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { paginated } from '../../common/utils/pagination.utils';
import { LabTestsService } from '../lab-tests/lab-tests.service';
import { VisitAccessService } from './visit-access.service';
import {
  CreateInvestigationsDto,
  ListInvestigationsQueryDto,
  UpdateInvestigationDto,
} from './dto/investigation.dto';

@Injectable()
export class InvestigationsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly visitAccess: VisitAccessService,
    private readonly labTestsService: LabTestsService,
  ) {}

  async listForVisit(visitId: string, user: AuthContext) {
    const visit = await this.visitAccess.loadOrThrow(visitId, user);
    await this.visitAccess.assertBranchAccess(visit, user);
    return this.prismaService.db.visitInvestigation.findMany({
      where: { visit_id: visitId, is_deleted: false },
      orderBy: { ordered_at: 'asc' },
    });
  }

  async listForPatient(
    patientId: string,
    query: ListInvestigationsQueryDto,
    user: AuthContext,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where: Prisma.VisitInvestigationWhereInput = {
      is_deleted: false,
      visit: {
        is_deleted: false,
        episode: {
          is_deleted: false,
          journey: {
            is_deleted: false,
            organization_id: user.organizationId,
            patient_id: patientId,
          },
        },
      },
      ...(query.status && { status: query.status }),
    };
    const [items, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.visitInvestigation.findMany({
        where,
        orderBy: { ordered_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaService.db.visitInvestigation.count({ where }),
    ]);
    return paginated(items, { page, limit, total });
  }

  async createMany(
    visitId: string,
    dto: CreateInvestigationsDto,
    user: AuthContext,
  ) {
    const visit = await this.visitAccess.loadOrThrow(visitId, user);
    this.visitAccess.assertCanOrderInvestigations(visit, user);

    for (const item of dto.items) {
      this.assertItemShape(item);
      if (item.lab_test_id) {
        await this.labTestsService.assertReferenceable(item.lab_test_id, user);
      }
    }

    const created = await this.prismaService.db.$transaction(
      dto.items.map((item) =>
        this.prismaService.db.visitInvestigation.create({
          data: {
            visit_id: visitId,
            lab_test_id: item.lab_test_id ?? null,
            custom_test_name: item.custom_test_name ?? null,
            notes: item.notes ?? null,
            lab_facility: item.lab_facility ?? null,
            ordered_by_id: user.profileId,
            status: InvestigationStatus.ORDERED,
          },
        }),
      ),
    );
    return { data: created };
  }

  async update(id: string, dto: UpdateInvestigationDto, user: AuthContext) {
    const investigation = await this.loadOrThrow(id, user);
    await this.visitAccess.assertBranchAccess(investigation.visit, user);

    const data: Prisma.VisitInvestigationUpdateInput = {};
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.lab_facility !== undefined) data.lab_facility = dto.lab_facility;
    if (dto.external_ref !== undefined) data.external_ref = dto.external_ref;
    if (dto.external_provider !== undefined)
      data.external_provider = dto.external_provider;

    const enteringResult =
      dto.result_text !== undefined ||
      dto.result_attachment_url !== undefined ||
      dto.status === InvestigationStatus.RESULTED;
    if (dto.result_text !== undefined) data.result_text = dto.result_text;
    if (dto.result_attachment_url !== undefined)
      data.result_attachment_url = dto.result_attachment_url;
    if (dto.result_source !== undefined) data.result_source = dto.result_source;

    if (enteringResult) {
      data.status = InvestigationStatus.RESULTED;
      data.resulted_at = new Date();
      data.resulted_by = { connect: { id: user.profileId } };
    } else if (dto.status !== undefined) {
      if (dto.status === InvestigationStatus.REVIEWED) {
        throw new BadRequestException(
          'Use POST /investigations/:id/review to mark as reviewed',
        );
      }
      data.status = dto.status;
      if (dto.status === InvestigationStatus.CANCELLED) {
        // ok
      }
    }

    return this.prismaService.db.visitInvestigation.update({
      where: { id },
      data,
    });
  }

  async review(id: string, user: AuthContext) {
    const investigation = await this.loadOrThrow(id, user);
    if (investigation.visit.assigned_doctor_id !== user.profileId) {
      throw new ForbiddenException(
        'Only the assigned doctor can review investigations',
      );
    }
    if (investigation.status !== InvestigationStatus.RESULTED) {
      throw new BadRequestException(
        `Cannot review an investigation in status ${investigation.status}`,
      );
    }
    return this.prismaService.db.visitInvestigation.update({
      where: { id },
      data: {
        status: InvestigationStatus.REVIEWED,
        reviewed_at: new Date(),
        reviewed_by: { connect: { id: user.profileId } },
      },
    });
  }

  private async loadOrThrow(id: string, user: AuthContext) {
    const inv = await this.prismaService.db.visitInvestigation.findUnique({
      where: { id, is_deleted: false },
      include: {
        visit: {
          include: {
            episode: {
              select: { journey: { select: { organization_id: true } } },
            },
          },
        },
      },
    });
    if (
      !inv ||
      !inv.visit ||
      inv.visit.episode?.journey?.organization_id !== user.organizationId
    ) {
      throw new NotFoundException(`Investigation ${id} not found`);
    }
    return inv;
  }

  private assertItemShape(item: {
    lab_test_id?: string;
    custom_test_name?: string;
  }) {
    const hasCatalog = !!item.lab_test_id;
    const hasCustom =
      !!item.custom_test_name && item.custom_test_name.trim().length > 0;
    if (hasCatalog === hasCustom) {
      throw new BadRequestException(
        'Each investigation must have exactly one of lab_test_id or custom_test_name',
      );
    }
  }
}
