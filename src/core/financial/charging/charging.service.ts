import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChargeSource,
  ChargeStatus,
  PricingSource,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.public.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { paginated } from '@common/utils/pagination.utils.js';
import { PricingResolverService } from '../pricing/pricing-resolver.service.js';
import { Money } from '../shared/money/money.js';
import { DEFAULT_CURRENCY } from '../shared/currency.js';
import {
  FINANCIAL_EVENTS,
  type ChargeCapturedEvent,
  type ChargeUpdatedEvent,
} from '../shared/events/financial-events.js';
import type { CaptureChargeDto } from './dto/capture-charge.dto.js';
import type { UpdateChargeDto } from './dto/update-charge.dto.js';

interface ListChargesFilters {
  patient_id?: string;
  visit_id?: string;
  branch_id?: string;
  status?: ChargeStatus;
}

/**
 * Charge capture — the record of a billable service rendered to a patient,
 * independent of how (or whether) it is later invoiced. A PENDING charge is an
 * open item that invoicing pulls into an invoice; voided / written-off charges
 * never reach an invoice.
 */
@Injectable()
export class ChargingService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly pricingResolver: PricingResolverService,
    private readonly patientAccess: PatientAccessService,
    private readonly eventBus: EventBus,
  ) {}

  async capture(
    organizationId: string,
    dto: CaptureChargeDto,
    user: AuthContext,
  ) {
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      organizationId,
      dto.branch_id,
    );
    await this.patientAccess.assertPatientInOrg(dto.patient_id, user);
    if (dto.visit_id) {
      await this.patientAccess.assertVisitInOrg(dto.visit_id, user);
    }

    let description = dto.description;
    if (dto.service_id) {
      const service = await this.prismaService.db.service.findFirst({
        where: {
          id: dto.service_id,
          OR: [{ organization_id: organizationId }, { organization_id: null }],
          is_deleted: false,
        },
        select: { name: true },
      });
      if (!service) throw new NotFoundException('Service not found');
      description ??= service.name;
    }
    if (!description) {
      throw new BadRequestException(
        'description is required when no service is selected',
      );
    }

    let unitPrice: Prisma.Decimal;
    let currency: string;
    let pricingSource: PricingSource;
    if (dto.unit_price !== undefined) {
      unitPrice = Money.of(dto.unit_price);
      currency = dto.currency ?? DEFAULT_CURRENCY;
      pricingSource = PricingSource.CUSTOM;
    } else if (dto.service_id) {
      const resolved = await this.pricingResolver.resolvePrice({
        organizationId,
        branchId: dto.branch_id,
        serviceId: dto.service_id,
        profileId: dto.profile_id,
        quantity: dto.quantity ?? 1,
      });
      if (!resolved) {
        throw new BadRequestException(
          'No price could be resolved for this service; provide unit_price explicitly.',
        );
      }
      unitPrice = resolved.price;
      currency = resolved.currency;
      pricingSource = resolved.source;
    } else {
      throw new BadRequestException(
        'Provide a service_id (for price resolution) or an explicit unit_price.',
      );
    }

    // Who originated the charge: a doctor capturing their own rendered service,
    // otherwise the front desk recording it on the provider's behalf. SYSTEM is
    // reserved for internal/event-driven captures (not this endpoint).
    const source =
      dto.source ??
      (dto.profile_id === user.profileId
        ? ChargeSource.DOCTOR
        : ChargeSource.RECEPTION);

    const charge = await this.prismaService.db.charge.create({
      data: {
        organization_id: organizationId,
        branch_id: dto.branch_id,
        patient_id: dto.patient_id,
        visit_id: dto.visit_id ?? null,
        profile_id: dto.profile_id,
        service_id: dto.service_id ?? null,
        description,
        quantity: dto.quantity ?? 1,
        unit_price: unitPrice,
        currency,
        pricing_source: pricingSource,
        source,
        status: ChargeStatus.PENDING,
        captured_by_id: user.profileId,
      },
    });

    this.eventBus.publish<ChargeCapturedEvent>(
      FINANCIAL_EVENTS.charge.captured,
      {
        charge_id: charge.id,
        organization_id: charge.organization_id,
        branch_id: charge.branch_id,
        patient_id: charge.patient_id,
        visit_id: charge.visit_id,
        service_id: charge.service_id,
        amount: Money.multiply(charge.unit_price, charge.quantity),
        pricing_source: charge.pricing_source,
        captured_by_id: charge.captured_by_id,
      },
    );

    return charge;
  }

  async list(
    organizationId: string,
    filters: ListChargesFilters,
    page = 1,
    limit = 20,
    user: AuthContext,
  ) {
    // Branch-scoped view is open to branch staff; the org-wide view is OWNER-only.
    if (filters.branch_id) {
      await this.authorizationService.assertCanAccessBranch(
        user.profileId,
        organizationId,
        filters.branch_id,
      );
    } else {
      await this.authorizationService.assertCanManageOrganization(
        user.profileId,
        organizationId,
      );
    }

    const where: Prisma.ChargeWhereInput = {
      organization_id: organizationId,
      is_deleted: false,
      ...(filters.branch_id && { branch_id: filters.branch_id }),
      ...(filters.patient_id && { patient_id: filters.patient_id }),
      ...(filters.visit_id && { visit_id: filters.visit_id }),
      ...(filters.status && { status: filters.status }),
    };

    const [items, total] = await Promise.all([
      this.prismaService.db.charge.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { captured_at: 'desc' },
      }),
      this.prismaService.db.charge.count({ where }),
    ]);

    return paginated(items, { page, limit, total });
  }

  /**
   * Pre-invoice correction of an open charge. Only quantity and/or description
   * may change — the unit price stays frozen at its captured value so prior
   * price changes never retroactively alter a charge.
   */
  async update(
    organizationId: string,
    chargeId: string,
    dto: UpdateChargeDto,
    user: AuthContext,
  ) {
    if (dto.quantity === undefined && dto.description === undefined) {
      throw new BadRequestException(
        'Provide quantity and/or description to update',
      );
    }
    const charge = await this.findOpenOrThrow(organizationId, chargeId);
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      organizationId,
      charge.branch_id,
    );

    const updated = await this.prismaService.db.charge.update({
      where: { id: chargeId },
      data: {
        ...(dto.quantity !== undefined && { quantity: dto.quantity }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
    });

    this.eventBus.publish<ChargeUpdatedEvent>(FINANCIAL_EVENTS.charge.updated, {
      charge_id: updated.id,
      organization_id: organizationId,
      quantity: updated.quantity,
    });
    return updated;
  }

  /** All charges for a visit, plus a rollup of the still-open (PENDING) total. */
  async getByVisit(organizationId: string, visitId: string, user: AuthContext) {
    await this.patientAccess.assertVisitInOrg(visitId, user);
    const charges = await this.prismaService.db.charge.findMany({
      where: {
        organization_id: organizationId,
        visit_id: visitId,
        is_deleted: false,
      },
      orderBy: { captured_at: 'desc' },
    });

    const pending = charges.filter((c) => c.status === ChargeStatus.PENDING);
    const pendingTotal = Money.sum(
      pending.map((c) => Money.multiply(c.unit_price, c.quantity)),
    );

    return {
      charges,
      summary: {
        currency: charges[0]?.currency ?? DEFAULT_CURRENCY,
        pending_total: pendingTotal,
        charge_count: charges.length,
      },
    };
  }

  /** Cancel an open charge — reuses the VOID path (PENDING → VOID). */
  cancel(organizationId: string, chargeId: string, user: AuthContext) {
    return this.void(organizationId, chargeId, user);
  }

  async void(organizationId: string, chargeId: string, user: AuthContext) {
    const charge = await this.findOpenOrThrow(organizationId, chargeId);
    await this.authorizationService.assertCanManageBranch(
      user.profileId,
      organizationId,
      charge.branch_id,
    );
    const updated = await this.prismaService.db.charge.update({
      where: { id: chargeId },
      data: { status: ChargeStatus.VOID },
    });
    this.eventBus.publish(FINANCIAL_EVENTS.charge.voided, {
      charge_id: chargeId,
      organization_id: organizationId,
    });
    return updated;
  }

  async writeOff(organizationId: string, chargeId: string, user: AuthContext) {
    const charge = await this.findOpenOrThrow(organizationId, chargeId);
    await this.authorizationService.assertCanManageBranch(
      user.profileId,
      organizationId,
      charge.branch_id,
    );
    const updated = await this.prismaService.db.charge.update({
      where: { id: chargeId },
      data: { status: ChargeStatus.WRITTEN_OFF },
    });
    this.eventBus.publish(FINANCIAL_EVENTS.charge.writtenOff, {
      charge_id: chargeId,
      organization_id: organizationId,
    });
    return updated;
  }

  private async findOpenOrThrow(organizationId: string, chargeId: string) {
    const charge = await this.prismaService.db.charge.findFirst({
      where: {
        id: chargeId,
        organization_id: organizationId,
        is_deleted: false,
      },
    });
    if (!charge) throw new NotFoundException('Charge not found');
    if (charge.status !== ChargeStatus.PENDING) {
      throw new ConflictException(
        `Charge is ${charge.status} and can no longer be modified`,
      );
    }
    return charge;
  }
}
