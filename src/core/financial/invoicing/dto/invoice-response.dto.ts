import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DiscountType, InvoiceStatus, InvoiceType } from '@prisma/client';

/**
 * Typed invoice contract. Monetary columns are Prisma `Decimal` and serialize
 * as strings. `balance_due` is a persisted column (= total_amount − paid_amount),
 * recomputed whenever totals or payments change.
 */
export class InvoiceResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() invoice_number!: string;
  @ApiProperty({ enum: InvoiceType }) invoice_type!: InvoiceType;
  @ApiProperty({ enum: InvoiceStatus }) status!: InvoiceStatus;

  @ApiProperty() organization_id!: string;
  @ApiProperty() branch_id!: string;
  @ApiProperty() patient_id!: string;
  @ApiPropertyOptional() visit_id!: string | null;
  @ApiPropertyOptional() assigned_doctor_id!: string | null;

  // ---------- Aggregates ----------
  @ApiProperty({ description: 'Sum of line totals (Decimal as string).' })
  subtotal!: string;
  @ApiPropertyOptional({ enum: DiscountType })
  discount_type!: DiscountType | null;
  @ApiPropertyOptional({
    description: 'Percent or flat amount, per discount_type.',
  })
  discount_value!: string | null;
  @ApiProperty({
    description: 'Resolved discount amount applied to the total.',
  })
  discount_amount!: string;
  @ApiProperty() tax_amount!: string;
  @ApiProperty() total_amount!: string;
  @ApiProperty() paid_amount!: string;
  @ApiProperty({
    description: 'Outstanding balance = total_amount − paid_amount.',
  })
  balance_due!: string;
  @ApiProperty() currency!: string;

  @ApiPropertyOptional() notes!: string | null;
  @ApiPropertyOptional() issued_at!: Date | null;
  @ApiPropertyOptional() due_date!: Date | null;
  @ApiProperty() created_by_id!: string;
  @ApiProperty() created_at!: Date;
  @ApiProperty() updated_at!: Date;

  @ApiPropertyOptional({ type: 'array', items: { type: 'object' } })
  items?: unknown[];
  @ApiPropertyOptional({ type: 'array', items: { type: 'object' } })
  payments?: unknown[];

  @ApiPropertyOptional({
    description:
      'Embedded patient summary (id + full_name); present on list and detail responses.',
    type: 'object',
    properties: {
      id: { type: 'string' },
      full_name: { type: 'string' },
    },
  })
  patient?: { id: string; full_name: string };
}
