import { ApiPropertyOptional } from '@nestjs/swagger';
import { CashSessionStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListCashSessionsQueryDto {
  @ApiPropertyOptional()
  @IsUUID('4')
  @IsOptional()
  branch_id?: string;

  @ApiPropertyOptional({ enum: CashSessionStatus })
  @IsEnum(CashSessionStatus)
  @IsOptional()
  status?: CashSessionStatus;

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
