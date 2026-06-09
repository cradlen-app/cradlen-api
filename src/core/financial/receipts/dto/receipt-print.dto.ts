import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod, ReceiptStatus } from '@prisma/client';

/**
 * Printable receipt aggregate — everything needed to render/print a receipt,
 * resolved in one query. Decimals serialize as strings. The frontend renders
 * this (no server-side PDF). The org logo is exposed as its R2 object key; the
 * client fetches a presigned URL via the existing logo flow.
 */
class ReceiptPrintOrgDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() logo_object_key!: string | null;
}

class ReceiptPrintBranchDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() address!: string;
  @ApiProperty() city!: string;
  @ApiProperty() governorate!: string;
}

class ReceiptPrintPatientDto {
  @ApiProperty() id!: string;
  @ApiProperty() full_name!: string;
  @ApiProperty() phone_number!: string;
}

class ReceiptPrintInvoiceDto {
  @ApiProperty() id!: string;
  @ApiProperty() invoice_number!: string;
  @ApiProperty() total_amount!: string;
}

class ReceiptPrintPaymentDto {
  @ApiProperty() id!: string;
  @ApiProperty() amount!: string;
  @ApiProperty({ enum: PaymentMethod }) payment_method!: PaymentMethod;
  @ApiProperty() payment_date!: Date;
}

class ReceiptPrintIssuedByDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class ReceiptPrintDto {
  @ApiProperty() receipt_number!: string;
  @ApiProperty() issued_at!: Date;
  @ApiProperty({ enum: ReceiptStatus }) status!: ReceiptStatus;
  @ApiProperty() currency!: string;
  @ApiProperty({ description: 'Invoice balance after this payment.' })
  balance_after!: string;

  @ApiProperty({ type: ReceiptPrintOrgDto }) organization!: ReceiptPrintOrgDto;
  @ApiProperty({ type: ReceiptPrintBranchDto }) branch!: ReceiptPrintBranchDto;
  @ApiProperty({ type: ReceiptPrintPatientDto })
  patient!: ReceiptPrintPatientDto;
  @ApiProperty({ type: ReceiptPrintInvoiceDto })
  invoice!: ReceiptPrintInvoiceDto;
  @ApiProperty({ type: ReceiptPrintPaymentDto })
  payment!: ReceiptPrintPaymentDto;
  @ApiProperty({ type: ReceiptPrintIssuedByDto })
  issued_by!: ReceiptPrintIssuedByDto;
}
