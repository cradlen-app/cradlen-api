import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  type SubscriptionPayment,
  SubscriptionPaymentStatus,
} from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { StorageService } from '@infrastructure/storage/storage.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { SubscriptionPaymentsService } from '../subscription-payments.service.js';
import {
  SUBSCRIPTION_EVENTS,
  type SubscriptionPaymentSubmittedEvent,
} from '../../subscription.events.js';
import type { SubscriptionPaymentResponseDto } from '../dto/subscription-payment-response.dto.js';
import type {
  ConfirmProofDto,
  CreateProofUploadDto,
  ProofUploadUrlDto,
} from './dto/subscription-payment-proof.dto.js';

/** Max proof files per payment. */
const MAX_PROOFS = 5;

/** A proof may be added/removed only while the payment is not yet decided. */
const OPEN_STATUSES: SubscriptionPaymentStatus[] = [
  SubscriptionPaymentStatus.PENDING,
  SubscriptionPaymentStatus.AWAITING_VERIFICATION,
];

/**
 * Proof-of-payment uploads for a manual-settlement subscription payment. The
 * owner uploads a receipt directly to R2 via a presigned PUT, then confirms the
 * object key — which flips the payment to AWAITING_VERIFICATION. Mirrors the
 * patient investigation-results upload pattern.
 */
@Injectable()
export class SubscriptionPaymentProofsService {
  private readonly logger = new Logger(SubscriptionPaymentProofsService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly storageService: StorageService,
    private readonly authorizationService: AuthorizationService,
    private readonly paymentsService: SubscriptionPaymentsService,
    private readonly eventBus: EventBus,
  ) {}

  private proofPrefix(paymentId: string): string {
    return `subscription-payments/${paymentId}/proofs/`;
  }

  /** Issues a short-lived presigned PUT URL for a proof file. OWNER-only. */
  async createUploadUrl(
    organizationId: string,
    paymentId: string,
    dto: CreateProofUploadDto,
    user: AuthContext,
  ): Promise<ProofUploadUrlDto> {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      organizationId,
    );
    const payment = await this.findOpenPaymentOrThrow(
      organizationId,
      paymentId,
    );

    this.storageService.assertAllowedContentType(dto.content_type);
    this.storageService.assertWithinSizeLimit(dto.size_bytes);

    const ext = this.storageService.extensionFor(dto.content_type);
    const key = `${this.proofPrefix(payment.id)}${randomUUID()}.${ext}`;

    const { url, expiresIn } =
      await this.storageService.createPresignedUploadUrl({
        key,
        contentType: dto.content_type,
      });

    return {
      key,
      upload_url: url,
      expires_in: expiresIn,
      content_type: dto.content_type,
    };
  }

  /**
   * Confirms an uploaded proof: validates the key belongs to this payment and
   * the object landed in R2, appends the proof, and flips a PENDING payment to
   * AWAITING_VERIFICATION (all in one transaction). OWNER-only.
   */
  async confirmProof(
    organizationId: string,
    paymentId: string,
    dto: ConfirmProofDto,
    user: AuthContext,
  ): Promise<SubscriptionPaymentResponseDto> {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      organizationId,
    );
    const payment = await this.findOpenPaymentOrThrow(
      organizationId,
      paymentId,
    );

    // Security: the key must be one we issued for THIS payment.
    if (!dto.key.startsWith(this.proofPrefix(payment.id))) {
      throw new BadRequestException('Invalid proof key');
    }

    const head = await this.storageService.headObject(dto.key);
    if (!head) {
      throw new BadRequestException('Uploaded file not found');
    }
    if (head.contentType) {
      this.storageService.assertAllowedContentType(head.contentType);
    }
    if (typeof head.contentLength === 'number') {
      this.storageService.assertWithinSizeLimit(head.contentLength);
    }

    const liveCount =
      await this.prismaService.db.subscriptionPaymentProof.count({
        where: { subscription_payment_id: payment.id, is_deleted: false },
      });
    if (liveCount >= MAX_PROOFS) {
      throw new ConflictException('Proof limit reached for this payment');
    }

    const becameAwaiting = payment.status === SubscriptionPaymentStatus.PENDING;

    await this.prismaService.db.$transaction(async (tx) => {
      await tx.subscriptionPaymentProof.create({
        data: {
          subscription_payment_id: payment.id,
          object_key: dto.key,
          content_type: head.contentType ?? null,
          size_bytes:
            typeof head.contentLength === 'number' ? head.contentLength : null,
        },
      });
      if (becameAwaiting) {
        await tx.subscriptionPayment.update({
          where: { id: payment.id },
          data: { status: SubscriptionPaymentStatus.AWAITING_VERIFICATION },
        });
      }
    });

    if (becameAwaiting) {
      this.eventBus.publish<SubscriptionPaymentSubmittedEvent>(
        SUBSCRIPTION_EVENTS.payment.submitted,
        {
          payment_id: payment.id,
          organization_id: organizationId,
          amount: payment.amount.toString(),
          currency: payment.currency,
        },
      );
    }

    return this.paymentsService.get(organizationId, payment.id, user);
  }

  /** Removes a proof file while the payment is still open. OWNER-only. */
  async removeProof(
    organizationId: string,
    paymentId: string,
    proofId: string,
    user: AuthContext,
  ): Promise<SubscriptionPaymentResponseDto> {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      organizationId,
    );
    const payment = await this.findOpenPaymentOrThrow(
      organizationId,
      paymentId,
    );

    const proof =
      await this.prismaService.db.subscriptionPaymentProof.findFirst({
        where: {
          id: proofId,
          subscription_payment_id: payment.id,
          is_deleted: false,
        },
      });
    if (!proof) throw new NotFoundException('Proof not found');

    await this.prismaService.db.subscriptionPaymentProof.update({
      where: { id: proof.id },
      data: { is_deleted: true, deleted_at: new Date() },
    });

    // Best-effort: the row is already gone, so a storage hiccup shouldn't 500.
    try {
      await this.storageService.deleteObject(proof.object_key);
    } catch {
      this.logger.warn(
        `Failed to delete R2 object for removed proof ${proof.id}`,
      );
    }

    return this.paymentsService.get(organizationId, payment.id, user);
  }

  private async findOpenPaymentOrThrow(
    organizationId: string,
    paymentId: string,
  ): Promise<SubscriptionPayment> {
    const payment = await this.prismaService.db.subscriptionPayment.findFirst({
      where: {
        id: paymentId,
        organization_id: organizationId,
        is_deleted: false,
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (!OPEN_STATUSES.includes(payment.status)) {
      throw new ConflictException(
        `This payment can no longer be modified (status: ${payment.status})`,
      );
    }
    return payment;
  }
}
