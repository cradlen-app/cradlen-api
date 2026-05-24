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
import { InvoiceType } from '@prisma/client';

export class InvoiceItemInputDto {
  @IsUUID()
  @IsOptional()
  service_id?: string;

  @IsString()
  description!: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  quantity?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemInputDto)
  @IsOptional()
  items?: InvoiceItemInputDto[];
}
