import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceType } from '@prisma/client';

export class ServiceResponseDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional() organization_id!: string | null;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() description!: string | null;
  @ApiProperty({ enum: ServiceType }) service_type!: ServiceType;
  @ApiProperty() is_active!: boolean;
  @ApiProperty({ type: [String] }) specialty_ids!: string[];
  @ApiProperty() created_at!: Date;
  @ApiProperty() updated_at!: Date;
}
