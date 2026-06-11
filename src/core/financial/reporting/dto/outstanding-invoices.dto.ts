import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvoiceStatus } from '@prisma/client';

export class OutstandingInvoiceRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() invoice_number!: string;
  @ApiProperty() patient_id!: string;
  @ApiProperty() patient_name!: string;
  @ApiPropertyOptional() doctor_name!: string | null;
  @ApiProperty({ enum: InvoiceStatus }) status!: InvoiceStatus;
  @ApiProperty() total_amount!: string;
  @ApiProperty() paid_amount!: string;
  @ApiProperty() balance_due!: string;
  @ApiPropertyOptional() issued_at!: Date | null;
  @ApiPropertyOptional() due_date!: Date | null;
  @ApiPropertyOptional() last_payment_date!: Date | null;
  @ApiProperty() age_days!: number;
  @ApiProperty({ description: 'current | d1_30 | d31_60 | d61_90 | d90_plus' })
  aging_bucket!: string;
}

export class OutstandingInvoicesReportDto {
  @ApiProperty({ type: [OutstandingInvoiceRowDto] })
  invoices!: OutstandingInvoiceRowDto[];
  @ApiProperty() total_outstanding!: string;
  @ApiProperty() count!: number;
}
