import { ApiPropertyOptional } from '@nestjs/swagger';
import { InvoiceStatus, InvoiceType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListInvoicesQueryDto {
  @ApiPropertyOptional({ enum: InvoiceStatus })
  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus;

  @ApiPropertyOptional()
  @IsUUID('4')
  @IsOptional()
  patient_id?: string;

  @ApiPropertyOptional()
  @IsUUID('4')
  @IsOptional()
  branch_id?: string;

  @ApiPropertyOptional({ enum: InvoiceType })
  @IsEnum(InvoiceType)
  @IsOptional()
  type?: InvoiceType;

  @ApiPropertyOptional()
  @IsOptional()
  date_from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  date_to?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;
}
