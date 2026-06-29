import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { StorageService } from '@infrastructure/storage/storage.service.js';
import { paginated } from '@common/utils/pagination.utils.js';
import type { AdminPaymentsQueryDto } from './dto/admin-list-query.dto.js';
import type {
  AdminPaymentDetailDto,
  AdminPaymentListItemDto,
} from './dto/admin-read-response.dto.js';

type PaymentRow = Prisma.SubscriptionPaymentGetPayload<{
  include: { organization: true; subscription_plan: true };
}>;

/** Resolved submitter contact (a Profile → User), keyed by profile id. */
type Submitter = { name: string; email: string | null; phone: string | null };

/**
 * Cross-tenant subscription-payment list/detail for the admin dashboard. Detail
 * mints short-lived presigned GET URLs for each manual-payment proof so the
 * admin can view the bank-transfer slip before verifying. `submitted_by_id` is a
 * Profile id and `verified_by_id` a PlatformAdmin id — neither has a relation on
 * the payment model, so both are resolved with explicit lookups (batched on the
 * list) to answer "who submitted / who verified".
 */
@Injectable()
export class AdminPaymentsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async list(query: AdminPaymentsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.SubscriptionPaymentWhereInput = {
      is_deleted: false,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            organization: {
              name: { contains: query.search, mode: 'insensitive' },
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prismaService.db.subscriptionPayment.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: { organization: true, subscription_plan: true },
      }),
      this.prismaService.db.subscriptionPayment.count({ where }),
    ]);

    const submitters = await this.resolveSubmitters(
      items.map((p) => p.submitted_by_id),
    );

    return paginated(
      items.map((p) =>
        this.toListItem(p, submitters.get(p.submitted_by_id ?? '')),
      ),
      { page, limit, total },
    );
  }

  async get(id: string): Promise<AdminPaymentDetailDto> {
    const payment = await this.prismaService.db.subscriptionPayment.findFirst({
      where: { id, is_deleted: false },
      include: {
        organization: true,
        subscription_plan: true,
        proofs: {
          where: { is_deleted: false },
          orderBy: { created_at: 'desc' },
        },
        items: {
          where: { is_deleted: false },
          include: { add_on: true, subscription_plan: true },
        },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    const [submitters, verifier, proofs] = await Promise.all([
      this.resolveSubmitters([payment.submitted_by_id]),
      payment.verified_by_id
        ? this.prismaService.db.platformAdmin.findUnique({
            where: { id: payment.verified_by_id },
            select: { full_name: true },
          })
        : Promise.resolve(null),
      Promise.all(
        payment.proofs.map(async (proof) => ({
          id: proof.id,
          url: await this.storageService.createPresignedDownloadUrl(
            proof.object_key,
          ),
          content_type: proof.content_type,
          size_bytes: proof.size_bytes,
          created_at: proof.created_at,
        })),
      ),
    ]);

    const submitter = submitters.get(payment.submitted_by_id ?? '');

    // PLAN line first, then add-ons — nested-create rows can share created_at.
    const items = payment.items
      .map((it) => ({
        kind: it.kind,
        label:
          it.kind === 'PLAN'
            ? (it.subscription_plan?.plan ?? 'Plan')
            : (it.add_on?.name ?? 'Add-on'),
        quantity: it.quantity,
        unit_amount: it.unit_amount.toString(),
        amount: it.amount.toString(),
      }))
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'PLAN' ? -1 : 1));

    return {
      ...this.toListItem(payment, submitter),
      submitted_by_phone: submitter?.phone ?? null,
      verified_by_name: verifier?.full_name ?? null,
      proofs,
      items,
    };
  }

  /** Batch-resolve profile ids → submitter contact, skipping nulls. */
  private async resolveSubmitters(
    ids: (string | null)[],
  ): Promise<Map<string, Submitter>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Map();

    const profiles = await this.prismaService.db.profile.findMany({
      where: { id: { in: unique } },
      include: { user: true },
    });

    return new Map(
      profiles.map((profile) => [
        profile.id,
        {
          name: `${profile.user.first_name} ${profile.user.last_name}`.trim(),
          email: profile.user.email,
          phone: profile.user.phone_number,
        },
      ]),
    );
  }

  private toListItem(
    payment: PaymentRow,
    submitter?: Submitter,
  ): AdminPaymentListItemDto {
    return {
      id: payment.id,
      organization_id: payment.organization_id,
      organization_name: payment.organization.name,
      purpose: payment.purpose,
      plan: payment.subscription_plan.plan,
      status: payment.status,
      provider: payment.provider,
      reference: payment.provider_ref,
      billing_interval: payment.billing_interval,
      amount: payment.amount.toString(),
      currency: payment.currency,
      submitted_by_name: submitter?.name ?? null,
      submitted_by_email: submitter?.email ?? null,
      verified_by_id: payment.verified_by_id,
      verified_at: payment.verified_at,
      rejection_reason: payment.rejection_reason,
      created_at: payment.created_at,
    };
  }
}
