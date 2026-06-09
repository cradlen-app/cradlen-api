import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ServiceCategoryResponseDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional() organization_id!: string | null;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() description!: string | null;
  @ApiProperty() is_active!: boolean;
  @ApiProperty() created_at!: Date;
  @ApiProperty() updated_at!: Date;
}
