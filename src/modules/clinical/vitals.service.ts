import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { VisitAccessService } from './visit-access.service';
import { UpsertVitalsDto } from './dto/vitals.dto';

@Injectable()
export class VitalsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly visitAccess: VisitAccessService,
  ) {}

  async findOne(visitId: string, user: AuthContext) {
    const visit = await this.visitAccess.loadOrThrow(visitId, user);
    await this.visitAccess.assertBranchAccess(visit, user);
    return this.prismaService.db.visitVitals.findUnique({
      where: { visit_id: visitId },
    });
  }

  async upsert(visitId: string, dto: UpsertVitalsDto, user: AuthContext) {
    const visit = await this.visitAccess.loadOrThrow(visitId, user);
    await this.visitAccess.assertCanRecordVitals(visit, user);

    const bmi = this.computeBmi(dto.weight_kg, dto.height_cm);
    const data = {
      systolic_bp: dto.systolic_bp ?? null,
      diastolic_bp: dto.diastolic_bp ?? null,
      pulse: dto.pulse ?? null,
      temperature_c: dto.temperature_c ?? null,
      respiratory_rate: dto.respiratory_rate ?? null,
      spo2: dto.spo2 ?? null,
      weight_kg: dto.weight_kg ?? null,
      height_cm: dto.height_cm ?? null,
      bmi,
    };

    return this.prismaService.db.visitVitals.upsert({
      where: { visit_id: visitId },
      create: { visit_id: visitId, recorded_by_id: user.profileId, ...data },
      update: {
        recorded_by_id: user.profileId,
        recorded_at: new Date(),
        ...data,
      },
    });
  }

  private computeBmi(
    weight_kg: number | undefined,
    height_cm: number | undefined,
  ): number | null {
    if (!weight_kg || !height_cm || height_cm <= 0) return null;
    const heightM = height_cm / 100;
    const bmi = weight_kg / (heightM * heightM);
    return Math.round(bmi * 10) / 10;
  }
}
