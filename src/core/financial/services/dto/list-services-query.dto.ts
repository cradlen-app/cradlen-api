import { ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListServicesQueryDto {
  @ApiPropertyOptional({ enum: ServiceType })
  @IsEnum(ServiceType)
  @IsOptional()
  service_type?: ServiceType;

  @ApiPropertyOptional()
  @IsUUID('4')
  @IsOptional()
  specialty_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  active?: string;

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
