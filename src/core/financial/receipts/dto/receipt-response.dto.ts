import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethod, ReceiptStatus } from '@prisma/client';

/** A proof-of-payment receipt row. Monetary columns serialize as strings. */
export class ReceiptResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() receipt_number!: string;
  @ApiProperty() payment_id!: string;
  @ApiProperty() invoice_id!: string;
  @ApiProperty() patient_id!: string;
  @ApiProperty({ description: 'Decimal serialized as string.' })
  amount!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: PaymentMethod }) payment_method!: PaymentMethod;
  @ApiProperty({ description: 'Invoice balance after this payment.' })
  balance_after!: string;
  @ApiProperty({ enum: ReceiptStatus }) status!: ReceiptStatus;
  @ApiProperty() issued_by_id!: string;
  @ApiProperty() issued_at!: Date;
}
