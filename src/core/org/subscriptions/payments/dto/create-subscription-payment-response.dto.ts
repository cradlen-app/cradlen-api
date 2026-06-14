import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionPaymentResponseDto } from './subscription-payment-response.dto.js';
import type {
  PaymentInstructions,
  PaymentSettlementMode,
} from '../providers/provider.types.js';

export class CreateSubscriptionPaymentResponseDto {
  @ApiProperty({ type: SubscriptionPaymentResponseDto })
  payment!: SubscriptionPaymentResponseDto;

  @ApiProperty({ enum: ['MANUAL_PROOF', 'GATEWAY'] })
  settlement_mode!: PaymentSettlementMode;

  @ApiProperty()
  requires_proof!: boolean;

  @ApiPropertyOptional({
    description: 'Transfer instructions for manual-proof providers',
  })
  instructions?: PaymentInstructions;

  @ApiPropertyOptional({ description: 'Checkout URL for gateway providers' })
  redirect_url?: string;
}
