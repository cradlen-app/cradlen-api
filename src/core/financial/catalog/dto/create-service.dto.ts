import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceType, ServiceUnit } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateServiceDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: ServiceType })
  @IsEnum(ServiceType)
  service_type!: ServiceType;

  @ApiPropertyOptional({ description: 'ServiceCategory id (org or system).' })
  @IsUUID('4')
  @IsOptional()
  category_id?: string;

  @ApiPropertyOptional({ description: 'Default duration in minutes.' })
  @IsInt()
  @Min(0)
  @IsOptional()
  duration_minutes?: number;

  @ApiPropertyOptional({
    description:
      'External billing / CPT / insurance code (not the internal code).',
  })
  @IsString()
  @IsOptional()
  billing_code?: string;

  @ApiPropertyOptional({ enum: ServiceUnit, default: ServiceUnit.PER_SERVICE })
  @IsEnum(ServiceUnit)
  @IsOptional()
  unit?: ServiceUnit;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  specialty_ids?: string[];
}
