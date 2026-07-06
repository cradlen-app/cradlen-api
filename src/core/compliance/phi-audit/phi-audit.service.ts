import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { paginated } from '@common/utils/pagination.utils.js';

export type PhiActorType = 'STAFF' | 'PATIENT' | 'ADMIN' | 'SYSTEM';
export type PhiSubjectType = 'PATIENT' | 'VISIT';

export interface RecordPhiAccessInput {
  actorType: PhiActorType;
  userId?: string | null;
  profileId?: string | null;
  patientAccountId?: string | null;
  organizationId?: string | null;
  subjectType: PhiSubjectType;
  subjectId: string;
  patientId?: string | null;
  resource: string;
  route: string;
  purpose?: string | null;
  requestId?: string | null;
  ip?: string | null;
}

export interface ListPhiAccessQuery {
  patientId?: string;
  page?: number;
  limit?: number;
}

/**
 * Append-only writer/reader for the PHI read-access audit trail
 * (`phi_access_log`). Records are FK-free so they survive patient erasure.
 * The interceptor calls `record` off the request's critical path.
 */
@Injectable()
export class PhiAuditService {
  constructor(private readonly prismaService: PrismaService) {}

  async record(input: RecordPhiAccessInput): Promise<void> {
    // baseClient (not the request tx): the audit write is fire-and-forget and
    // cross-tenant — it must persist independently of the request's RLS
    // transaction, which may commit/roll back before this resolves.
    await this.prismaService.baseClient.phiAccessLog.create({
      data: {
        actor_type: input.actorType,
        user_id: input.userId ?? null,
        profile_id: input.profileId ?? null,
        patient_account_id: input.patientAccountId ?? null,
        organization_id: input.organizationId ?? null,
        subject_type: input.subjectType,
        subject_id: input.subjectId,
        patient_id: input.patientId ?? null,
        resource: input.resource,
        route: input.route,
        purpose: input.purpose ?? null,
        request_id: input.requestId ?? null,
        ip: input.ip ?? null,
      },
    });
  }

  /**
   * "Who accessed this patient" report. Matches rows where the patient is the
   * direct subject OR where a VISIT-subject row belongs to one of the patient's
   * visits (resolved at read time — VISIT rows carry no `patient_id`).
   */
  async list(query: ListPhiAccessQuery) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.PhiAccessLogWhereInput = {};
    if (query.patientId) {
      const visits = await this.prismaService.db.visit.findMany({
        where: { episode: { journey: { patient_id: query.patientId } } },
        select: { id: true },
      });
      const visitIds = visits.map((v) => v.id);
      where.OR = [
        { patient_id: query.patientId },
        { subject_type: 'VISIT', subject_id: { in: visitIds } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prismaService.db.phiAccessLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { at: 'desc' },
        select: {
          id: true,
          actor_type: true,
          user_id: true,
          profile_id: true,
          patient_account_id: true,
          organization_id: true,
          subject_type: true,
          subject_id: true,
          patient_id: true,
          action: true,
          resource: true,
          route: true,
          purpose: true,
          at: true,
        },
      }),
      this.prismaService.db.phiAccessLog.count({ where }),
    ]);

    return paginated(rows, { page, limit, total });
  }
}
