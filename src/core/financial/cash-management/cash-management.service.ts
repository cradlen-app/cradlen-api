import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CashSessionStatus, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { paginated } from '@common/utils/pagination.utils.js';
import { Money } from '../shared/money/money.js';
import {
  FINANCIAL_EVENTS,
  type CashSessionClosedEvent,
} from '../shared/events/financial-events.js';
import type { OpenCashSessionDto } from './dto/open-cash-session.dto.js';
import type { CloseCashSessionDto } from './dto/close-cash-session.dto.js';

interface ListCashSessionsFilters {
  branchId?: string;
  status?: CashSessionStatus;
}

/**
 * Cash drawer sessions. A cashier opens a session (one OPEN per cashier+branch),
 * cash payments link to it, and closing reconciles the counted cash against the
 * expected total (opening float + collected). A manager later marks it
 * RECONCILED.
 */
@Injectable()
export class CashManagementService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly eventBus: EventBus,
  ) {}

  async open(
    organizationId: string,
    dto: OpenCashSessionDto,
    user: AuthContext,
  ) {
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      organizationId,
      dto.branch_id,
    );

    const existing = await this.prismaService.db.cashSession.findFirst({
      where: {
        profile_id: user.profileId,
        branch_id: dto.branch_id,
        status: CashSessionStatus.OPEN,
        is_deleted: false,
      },
    });
    if (existing) {
      throw new ConflictException(
        'You already have an open cash session at this branch',
      );
    }

    let session;
    try {
      session = await this.prismaService.db.cashSession.create({
        data: {
          organization_id: organizationId,
          branch_id: dto.branch_id,
          profile_id: user.profileId,
          opening_float:
            dto.opening_float !== undefined
              ? Money.of(dto.opening_float)
              : Money.zero(),
          opened_by_id: user.profileId,
          status: CashSessionStatus.OPEN,
        },
      });
    } catch (err) {
      // Backstop the app-level check against a concurrent open racing to the
      // `one OPEN per (cashier, branch)` partial-unique index.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'You already have an open cash session at this branch',
        );
      }
      throw err;
    }

    this.eventBus.publish(FINANCIAL_EVENTS.cashSession.opened, {
      cash_session_id: session.id,
      organization_id: organizationId,
      branch_id: session.branch_id,
      profile_id: session.profile_id,
      opened_by_id: user.profileId,
    });
    return { ...session, summary: await this.drawerSummary(session) };
  }

  /** The caller's current OPEN drawer at a branch, with a live summary, or null. */
  async current(organizationId: string, branchId: string, user: AuthContext) {
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      organizationId,
      branchId,
    );
    const session = await this.prismaService.db.cashSession.findFirst({
      where: {
        organization_id: organizationId,
        branch_id: branchId,
        profile_id: user.profileId,
        status: CashSessionStatus.OPEN,
        is_deleted: false,
      },
    });
    if (!session) return null;
    return { ...session, summary: await this.drawerSummary(session) };
  }

  async close(
    organizationId: string,
    sessionId: string,
    dto: CloseCashSessionDto,
    user: AuthContext,
  ) {
    const session = await this.findSessionOrThrow(organizationId, sessionId);
    if (session.status !== CashSessionStatus.OPEN) {
      throw new BadRequestException('Only OPEN sessions can be closed');
    }

    // A cashier may close their own drawer; closing another's needs branch
    // management authority.
    if (session.profile_id === user.profileId) {
      await this.authorizationService.assertCanAccessBranch(
        user.profileId,
        organizationId,
        session.branch_id,
      );
    } else {
      await this.authorizationService.assertCanManageBranch(
        user.profileId,
        organizationId,
        session.branch_id,
      );
    }

    const { collected } = await this.collectLinkedCash(sessionId);
    const expected = Money.add(session.opening_float, collected);
    const counted = Money.of(dto.counted_amount);
    const variance = Money.subtract(counted, expected);

    const closed = await this.prismaService.db.cashSession.update({
      where: { id: sessionId },
      data: {
        status: CashSessionStatus.CLOSED,
        closed_by_id: user.profileId,
        closed_at: new Date(),
        expected_amount: expected,
        counted_amount: counted,
        variance,
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });

    this.eventBus.publish<CashSessionClosedEvent>(
      FINANCIAL_EVENTS.cashSession.closed,
      {
        cash_session_id: closed.id,
        organization_id: organizationId,
        branch_id: closed.branch_id,
        profile_id: closed.profile_id,
        expected_amount: expected,
        counted_amount: counted,
        variance,
        closed_by_id: user.profileId,
      },
    );
    return closed;
  }

  async reconcile(
    organizationId: string,
    sessionId: string,
    user: AuthContext,
  ) {
    const session = await this.findSessionOrThrow(organizationId, sessionId);
    await this.authorizationService.assertCanManageBranch(
      user.profileId,
      organizationId,
      session.branch_id,
    );
    if (session.status !== CashSessionStatus.CLOSED) {
      throw new BadRequestException('Only CLOSED sessions can be reconciled');
    }

    const reconciled = await this.prismaService.db.cashSession.update({
      where: { id: sessionId },
      data: { status: CashSessionStatus.RECONCILED },
    });

    this.eventBus.publish(FINANCIAL_EVENTS.cashSession.reconciled, {
      cash_session_id: reconciled.id,
      organization_id: organizationId,
      branch_id: reconciled.branch_id,
      reconciled_by_id: user.profileId,
    });
    return reconciled;
  }

  async list(
    organizationId: string,
    filters: ListCashSessionsFilters,
    page = 1,
    limit = 20,
    user: AuthContext,
  ) {
    if (filters.branchId) {
      await this.authorizationService.assertCanAccessBranch(
        user.profileId,
        organizationId,
        filters.branchId,
      );
    } else {
      await this.authorizationService.assertCanManageOrganization(
        user.profileId,
        organizationId,
      );
    }

    const where: Prisma.CashSessionWhereInput = {
      organization_id: organizationId,
      is_deleted: false,
      ...(filters.branchId && { branch_id: filters.branchId }),
      ...(filters.status && { status: filters.status }),
    };

    const [items, total] = await Promise.all([
      this.prismaService.db.cashSession.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { opened_at: 'desc' },
      }),
      this.prismaService.db.cashSession.count({ where }),
    ]);

    return paginated(items, { page, limit, total });
  }

  async getOne(organizationId: string, sessionId: string, user: AuthContext) {
    const session = await this.findSessionOrThrow(organizationId, sessionId);
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      organizationId,
      session.branch_id,
    );
    if (session.status === CashSessionStatus.OPEN) {
      return { ...session, summary: await this.drawerSummary(session) };
    }
    return session;
  }

  /** Sum of linked COMPLETED cash payments and their count. */
  private async collectLinkedCash(
    sessionId: string,
  ): Promise<{ collected: Prisma.Decimal; count: number }> {
    const payments = await this.prismaService.db.payment.findMany({
      where: {
        cash_session_id: sessionId,
        status: PaymentStatus.COMPLETED,
        is_deleted: false,
      },
      select: { amount: true },
    });
    return {
      collected: Money.sum(payments.map((p) => p.amount)),
      count: payments.length,
    };
  }

  /** Live drawer state: what the cashier should be holding right now. */
  private async drawerSummary(session: {
    id: string;
    opening_float: Prisma.Decimal;
  }) {
    const { collected, count } = await this.collectLinkedCash(session.id);
    return {
      collected,
      payment_count: count,
      expected_so_far: Money.add(session.opening_float, collected),
    };
  }

  private async findSessionOrThrow(organizationId: string, sessionId: string) {
    const session = await this.prismaService.db.cashSession.findFirst({
      where: {
        id: sessionId,
        organization_id: organizationId,
        is_deleted: false,
      },
    });
    if (!session) throw new NotFoundException('Cash session not found');
    return session;
  }
}
