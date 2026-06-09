import { ApiPropertyOptional } from '@nestjs/swagger';
import { ChargeStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListChargesQueryDto {
  @ApiPropertyOptional()
  @IsUUID('4')
  @IsOptional()
  patient_id?: string;

  @ApiPropertyOptional()
  @IsUUID('4')
  @IsOptional()
  visit_id?: string;

  @ApiPropertyOptional()
  @IsUUID('4')
  @IsOptional()
  branch_id?: string;

  @ApiPropertyOptional({ enum: ChargeStatus })
  @IsEnum(ChargeStatus)
  @IsOptional()
  status?: ChargeStatus;

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
