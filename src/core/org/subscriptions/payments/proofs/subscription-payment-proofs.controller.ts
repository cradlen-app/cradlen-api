import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { ApiStandardResponse } from '@common/swagger/index.js';
import { SubscriptionPaymentProofsService } from './subscription-payment-proofs.service.js';
import { SkipSubscriptionCheck } from '../../skip-subscription-check.decorator.js';
import {
  ConfirmProofDto,
  CreateProofUploadDto,
  ProofUploadUrlDto,
} from './dto/subscription-payment-proof.dto.js';
import { SubscriptionPaymentResponseDto } from '../dto/subscription-payment-response.dto.js';

@ApiTags('Subscription Payments')
@ApiBearerAuth()
@SkipSubscriptionCheck()
@Controller('organizations/:orgId/subscription/payments/:paymentId/proof')
export class SubscriptionPaymentProofsController {
  constructor(
    private readonly proofsService: SubscriptionPaymentProofsService,
  ) {}

  @Post('upload-url')
  @ApiStandardResponse(ProofUploadUrlDto)
  createUploadUrl(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: CreateProofUploadDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.proofsService.createUploadUrl(orgId, paymentId, dto, user);
  }

  @Post()
  @ApiStandardResponse(SubscriptionPaymentResponseDto)
  confirm(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: ConfirmProofDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.proofsService.confirmProof(orgId, paymentId, dto, user);
  }

  @Delete(':proofId')
  @ApiStandardResponse(SubscriptionPaymentResponseDto)
  remove(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Param('proofId', ParseUUIDPipe) proofId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.proofsService.removeProof(orgId, paymentId, proofId, user);
  }
}
