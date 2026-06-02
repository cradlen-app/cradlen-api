import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MedicationDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true }) organization_id!: string | null;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) generic_name!: string | null;
  @ApiPropertyOptional({ nullable: true }) form!: string | null;
  @ApiPropertyOptional({ nullable: true }) strength!: string | null;
  @ApiPropertyOptional({ nullable: true }) category!: string | null;
  @ApiPropertyOptional({ nullable: true }) company!: string | null;
  @ApiPropertyOptional({ nullable: true }) notes!: string | null;
  @ApiPropertyOptional({ nullable: true }) default_dose_amount!: number | null;
  @ApiPropertyOptional({ nullable: true }) default_dose_unit!: string | null;
  @ApiPropertyOptional({ nullable: true }) default_dose_frequency!:
    | string
    | null;
  @ApiPropertyOptional({ nullable: true }) default_dose_route!: string | null;
  @ApiPropertyOptional({ nullable: true }) added_by_id!: string | null;
  @ApiProperty() is_deleted!: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) created_at!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updated_at!: Date;
}

export class MedicationPrescriberDto {
  @ApiProperty() profile_id!: string;
  @ApiProperty() full_name!: string;
  @ApiProperty() count!: number;
}

export class MedicationRepSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() full_name!: string;
  @ApiProperty() company_name!: string;
}

export class MedicationWithStatsDto extends MedicationDto {
  @ApiProperty() total_prescriptions!: number;
  @ApiProperty({ type: [MedicationPrescriberDto] })
  top_prescribers!: MedicationPrescriberDto[];
  @ApiProperty({ type: [MedicationRepSummaryDto] })
  medical_reps!: MedicationRepSummaryDto[];
}
