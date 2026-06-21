import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DiscountType, InvoiceType } from '@prisma/client';
import { MAX_MONETARY_AMOUNT } from '../../shared/money/money.js';

export class InvoiceItemInputDto {
  @IsUUID()
  @IsOptional()
  service_id?: string;

  @IsString()
  description!: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_MONETARY_AMOUNT)
  unit_price!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  discount_amount?: number;
}

export class CreateInvoiceDto {
  @IsUUID()
  branch_id!: string;

  @IsUUID()
  patient_id!: string;

  @IsUUID()
  @IsOptional()
  visit_id?: string;

  @IsUUID()
  @IsOptional()
  assigned_doctor_id?: string;

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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemInputDto)
  @IsOptional()
  items?: InvoiceItemInputDto[];
}
