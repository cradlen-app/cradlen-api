import { ApiProperty } from '@nestjs/swagger';
import { InvoiceResponseDto } from '../../invoicing/dto/invoice-response.dto.js';
import { PaymentResponseDto } from './payment-response.dto.js';

/**
 * Result of recording or voiding a payment: the affected payment row (receipt)
 * plus the recomputed invoice (balance_due, paid_amount, status).
 */
export class PaymentResultDto {
  @ApiProperty({ type: PaymentResponseDto }) payment!: PaymentResponseDto;
  @ApiProperty({ type: InvoiceResponseDto }) invoice!: InvoiceResponseDto;
}
