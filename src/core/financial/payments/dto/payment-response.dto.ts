import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod, PaymentStatus } from '@prisma/client';

/** A recorded payment against an invoice. Monetary columns serialize as strings. */
export class PaymentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() invoice_id!: string;
  @ApiProperty({ description: 'Decimal serialized as string.' })
  amount!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: PaymentStatus }) status!: PaymentStatus;
  @ApiProperty({ enum: PaymentMethod }) payment_method!: PaymentMethod;
  @ApiProperty() payment_date!: Date;
  @ApiPropertyOptional() reference_number!: string | null;
  @ApiPropertyOptional() notes!: string | null;
  @ApiPropertyOptional() cash_session_id!: string | null;
  @ApiProperty() recorded_by_id!: string;
  @ApiProperty() created_at!: Date;
}
