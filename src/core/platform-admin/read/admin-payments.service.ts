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

/**
 * Cross-tenant subscription-payment list/detail for the admin dashboard. Detail
 * mints short-lived presigned GET URLs for each manual-payment proof so the
 * admin can view the bank-transfer slip before verifying.
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

    return paginated(
      items.map((p) => this.toListItem(p)),
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
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    const proofs = await Promise.all(
      payment.proofs.map(async (proof) => ({
        id: proof.id,
        url: await this.storageService.createPresignedDownloadUrl(
          proof.object_key,
        ),
        content_type: proof.content_type,
        size_bytes: proof.size_bytes,
        created_at: proof.created_at,
      })),
    );

    return { ...this.toListItem(payment), proofs };
  }

  private toListItem(payment: PaymentRow): AdminPaymentListItemDto {
    return {
      id: payment.id,
      organization_id: payment.organization_id,
      organization_name: payment.organization.name,
      purpose: payment.purpose,
      plan: payment.subscription_plan.plan,
      status: payment.status,
      provider: payment.provider,
      reference: payment.provider_ref,
      amount: payment.amount.toString(),
      currency: payment.currency,
      verified_by_id: payment.verified_by_id,
      verified_at: payment.verified_at,
      rejection_reason: payment.rejection_reason,
      created_at: payment.created_at,
    };
  }
}
