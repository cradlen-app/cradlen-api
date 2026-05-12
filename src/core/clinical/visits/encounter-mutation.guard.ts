import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { ERROR_CODES } from '@common/constant/error-codes';
import { LOCKS_ON_CLOSED_VISIT_KEY } from '@common/decorators/locks-on-closed-visit.decorator';

const LOCKED_STATUSES = new Set(['COMPLETED', 'CANCELLED']);

/**
 * Rejects mutations on visit-scoped resources once the parent visit is closed.
 *
 * Activates only on handlers decorated with `@LocksOnClosedVisit(paramName)`.
 * The decorator names the route parameter holding the visit UUID (default
 * `'id'`). When `visit.status` is `COMPLETED` or `CANCELLED`, the guard throws
 * `409 ENCOUNTER_LOCKED` with a hint pointing callers at the amendment flow.
 *
 * The amendment endpoint itself is intentionally undecorated, so it bypasses
 * this guard and is the only path for editing a closed encounter.
 */
@Injectable()
export class EncounterMutationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prismaService: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const paramName = this.reflector.getAllAndOverride<string | undefined>(
      LOCKS_ON_CLOSED_VISIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!paramName) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const visitId = request.params[paramName];
    if (typeof visitId !== 'string' || visitId.length === 0) {
      // Handler declared the guard but the param isn't on the route.
      // Treat as a programming error; surface as 404 to avoid leaking info.
      throw new NotFoundException(`Visit identifier not found in route`);
    }

    const visit = await this.prismaService.db.visit.findFirst({
      where: { id: visitId, is_deleted: false },
      select: { status: true },
    });
    if (!visit) {
      throw new NotFoundException(`Visit ${visitId} not found`);
    }

    if (LOCKED_STATUSES.has(visit.status)) {
      throw new ConflictException({
        code: ERROR_CODES.ENCOUNTER_LOCKED,
        message:
          'This visit is closed. Edits require an amendment with a documented reason.',
        details: {
          visit_id: visitId,
          status: visit.status,
          amendment_endpoint: `/v1/visits/${visitId}/amendments`,
        },
      });
    }

    return true;
  }
}
