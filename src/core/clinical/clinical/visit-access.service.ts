import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Visit, VisitStatus } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthorizationService } from '@core/auth/authorization/authorization.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';

@Injectable()
export class VisitAccessService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async loadOrThrow(visitId: string, user: AuthContext): Promise<Visit> {
    const visit = await this.prismaService.db.visit.findUnique({
      where: { id: visitId, is_deleted: false },
      include: {
        episode: {
          select: { journey: { select: { organization_id: true } } },
        },
      },
    });
    if (
      !visit ||
      !visit.episode?.journey ||
      visit.episode.journey.organization_id !== user.organizationId
    ) {
      throw new NotFoundException(`Visit ${visitId} not found`);
    }
    return visit;
  }

  async assertBranchAccess(visit: Visit, user: AuthContext) {
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      user.organizationId,
      visit.branch_id,
    );
  }

  assertAssignedDoctor(visit: Visit, user: AuthContext) {
    if (visit.assigned_doctor_id !== user.profileId) {
      throw new ForbiddenException(
        'Only the assigned doctor can perform this action',
      );
    }
  }

  async assertCanRecordVitals(visit: Visit, user: AuthContext) {
    await this.assertBranchAccess(visit, user);
    if (
      visit.status !== VisitStatus.CHECKED_IN &&
      visit.status !== VisitStatus.IN_PROGRESS
    ) {
      throw new ForbiddenException(
        `Cannot record vitals while visit is ${visit.status}`,
      );
    }
  }

  assertCanWriteEncounter(visit: Visit, user: AuthContext) {
    this.assertAssignedDoctor(visit, user);
    if (visit.status !== VisitStatus.IN_PROGRESS) {
      throw new ForbiddenException(
        `Encounter can only be written while visit is IN_PROGRESS (current: ${visit.status})`,
      );
    }
  }

  assertCanEditPrescription(visit: Visit, user: AuthContext) {
    this.assertAssignedDoctor(visit, user);
    if (
      visit.status === VisitStatus.COMPLETED ||
      visit.status === VisitStatus.CANCELLED ||
      visit.status === VisitStatus.NO_SHOW
    ) {
      throw new ForbiddenException(
        `Prescription cannot be edited while visit is ${visit.status}`,
      );
    }
  }

  assertCanOrderInvestigations(visit: Visit, user: AuthContext) {
    this.assertAssignedDoctor(visit, user);
    if (visit.status !== VisitStatus.IN_PROGRESS) {
      throw new ForbiddenException(
        `Investigations can only be ordered while visit is IN_PROGRESS (current: ${visit.status})`,
      );
    }
  }
}
