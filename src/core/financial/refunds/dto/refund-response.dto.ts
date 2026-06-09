import { ApiProperty } from '@nestjs/swagger';
import { RefundStatus } from '@prisma/client';

/** A refund against a completed payment. Monetary columns serialize as strings. */
export class RefundResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() payment_id!: string;
  @ApiProperty({ description: 'Decimal serialized as string.' })
  amount!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ enum: RefundStatus }) status!: RefundStatus;
  @ApiProperty() refunded_by_id!: string;
  @ApiProperty() refunded_at!: Date;
  @ApiProperty() created_at!: Date;
}
