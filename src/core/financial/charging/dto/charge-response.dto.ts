import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChargeSource, ChargeStatus, PricingSource } from '@prisma/client';

export class ChargeResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() organization_id!: string;
  @ApiProperty() branch_id!: string;
  @ApiProperty() patient_id!: string;
  @ApiPropertyOptional() visit_id!: string | null;
  @ApiProperty() profile_id!: string;
  @ApiPropertyOptional() service_id!: string | null;
  @ApiProperty() description!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty({ description: 'Decimal serialized as string.' })
  unit_price!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: PricingSource }) pricing_source!: PricingSource;
  @ApiProperty({ enum: ChargeSource }) source!: ChargeSource;
  @ApiProperty({ enum: ChargeStatus }) status!: ChargeStatus;
  @ApiProperty() captured_by_id!: string;
  @ApiProperty() captured_at!: Date;
  @ApiProperty() created_at!: Date;
  @ApiProperty() updated_at!: Date;
}
