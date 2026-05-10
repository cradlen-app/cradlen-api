import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

@Injectable()
export class PatientAccessService {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * The caller's organization has access to a patient iff it has at least one
   * PatientJourney for that patient (active, completed, or cancelled — soft-delete excluded).
   * Throws 404 to avoid leaking patient existence across orgs.
   */
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
}
