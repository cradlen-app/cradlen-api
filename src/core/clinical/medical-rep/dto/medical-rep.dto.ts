import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MedicalRepDto {
  @ApiProperty() id!: string;
  @ApiProperty() organization_id!: string;
  @ApiProperty() full_name!: string;
  @ApiPropertyOptional({ nullable: true }) national_id!: string | null;
  @ApiPropertyOptional({ nullable: true }) phone_number!: string | null;
  @ApiPropertyOptional({ nullable: true }) email!: string | null;
  @ApiProperty() company_name!: string;
  @ApiPropertyOptional({ nullable: true }) specialty_focus!: string | null;
  @ApiPropertyOptional({ nullable: true }) notes!: string | null;
  @ApiProperty() created_at!: Date;
}

export class MedicalRepSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() full_name!: string;
  @ApiPropertyOptional({ nullable: true }) national_id!: string | null;
  @ApiPropertyOptional({ nullable: true }) phone_number!: string | null;
  @ApiProperty() company_name!: string;
}

export class MedicalRepListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() full_name!: string;
  @ApiProperty() company_name!: string;
  @ApiPropertyOptional({ nullable: true }) national_id!: string | null;
  @ApiPropertyOptional({ nullable: true }) phone!: string | null;
  @ApiPropertyOptional({ nullable: true }) specialty_focus!: string | null;
  @ApiProperty({ type: [String] }) products!: string[];
  @ApiPropertyOptional({ nullable: true }) last_visit_date!: string | null;
  @ApiProperty() visits_count!: number;
}
