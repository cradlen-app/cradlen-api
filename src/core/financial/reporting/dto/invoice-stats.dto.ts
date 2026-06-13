import { ApiProperty } from '@nestjs/swagger';

/** A single status bucket: how many invoices and their summed amount. */
export class InvoiceStatBucketDto {
  @ApiProperty() count!: number;
  /** Decimal serialized as a string. Paid/Pending sum total; Unpaid/Overdue sum balance_due. */
  @ApiProperty() amount!: string;
}

export class InvoiceStatsReportDto {
  @ApiProperty({ type: InvoiceStatBucketDto }) paid!: InvoiceStatBucketDto;
  @ApiProperty({ type: InvoiceStatBucketDto }) unpaid!: InvoiceStatBucketDto;
  @ApiProperty({ type: InvoiceStatBucketDto }) pending!: InvoiceStatBucketDto;
  @ApiProperty({ type: InvoiceStatBucketDto }) overdue!: InvoiceStatBucketDto;
}
