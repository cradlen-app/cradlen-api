import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';
import { MAX_MONETARY_AMOUNT } from '../../shared/money/money.js';

export class RecordPaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(MAX_MONETARY_AMOUNT)
  amount!: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsEnum(PaymentMethod)
  payment_method!: PaymentMethod;

  @IsDateString()
  @IsOptional()
  payment_date?: string;

  @IsString()
  @IsOptional()
  reference_number?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
