import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { DiscountType, InvoiceType } from '@prisma/client';

/**
 * Assemble a DRAFT invoice from a patient's open (PENDING) charges. When
 * charge_ids is omitted, every open charge for the patient at the branch is
 * pulled in.
 */
export class BuildInvoiceFromChargesDto {
  @IsUUID()
  branch_id!: string;

  @IsUUID()
  patient_id!: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  charge_ids?: string[];

  @IsUUID()
  @IsOptional()
  visit_id?: string;

  @IsEnum(InvoiceType)
  @IsOptional()
  invoice_type?: InvoiceType;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsDateString()
  @IsOptional()
  due_date?: string;

  /** Invoice-level discount type. PERCENTAGE applies to the subtotal; FIXED is a flat amount. */
  @IsEnum(DiscountType)
  @IsOptional()
  discount_type?: DiscountType;

  /** Percent (when PERCENTAGE) or flat amount (when FIXED). */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  discount_value?: number;
}
