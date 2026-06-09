import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DiscountType } from '@prisma/client';
import { InvoiceItemInputDto } from './create-invoice.dto.js';

export class UpdateInvoiceDto {
  @IsUUID()
  @IsOptional()
  assigned_doctor_id?: string;

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
