import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RevenueByDoctorRowDto {
  @ApiPropertyOptional({ description: 'Null when no doctor is assigned.' })
  profile_id!: string | null;
  @ApiProperty() doctor_name!: string;
  @ApiProperty({ description: 'Billed invoice revenue (string).' })
  total!: string;
  @ApiProperty() invoice_count!: number;
}

export class RevenueByDoctorReportDto {
  @ApiProperty({ type: [RevenueByDoctorRowDto] })
  by_doctor!: RevenueByDoctorRowDto[];
  @ApiProperty() total!: string;
}
