import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RevenueByServiceRowDto {
  @ApiPropertyOptional({ description: 'Null for custom/uncategorized lines.' })
  service_id!: string | null;
  @ApiProperty() service_name!: string;
  @ApiProperty({ description: 'Billed line revenue (string).' })
  total!: string;
  @ApiProperty() line_count!: number;
}

export class RevenueByServiceReportDto {
  @ApiProperty({ type: [RevenueByServiceRowDto] })
  by_service!: RevenueByServiceRowDto[];
  @ApiProperty() total!: string;
}
