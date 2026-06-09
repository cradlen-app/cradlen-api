import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceType, ServiceUnit } from '@prisma/client';

export class EmbeddedServiceCategoryDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
}

export class ServiceResponseDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional() organization_id!: string | null;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() description!: string | null;
  @ApiProperty({ enum: ServiceType }) service_type!: ServiceType;
  @ApiPropertyOptional() category_id!: string | null;
  @ApiPropertyOptional({ type: EmbeddedServiceCategoryDto })
  category!: EmbeddedServiceCategoryDto | null;
  @ApiPropertyOptional() duration_minutes!: number | null;
  @ApiPropertyOptional() billing_code!: string | null;
  @ApiProperty({ enum: ServiceUnit }) unit!: ServiceUnit;
  @ApiProperty() is_active!: boolean;
  @ApiProperty({ type: [String] }) specialty_ids!: string[];
  @ApiProperty() created_at!: Date;
  @ApiProperty() updated_at!: Date;
}
