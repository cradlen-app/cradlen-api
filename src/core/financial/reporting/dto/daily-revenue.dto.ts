import { ApiProperty } from '@nestjs/swagger';

export class DailyRevenueRowDto {
  @ApiProperty({ description: 'Day (YYYY-MM-DD, UTC).' })
  date!: string;
  @ApiProperty({ description: 'Invoices issued that day (string).' })
  invoiced!: string;
  @ApiProperty({ description: 'Payments received that day (string).' })
  collected!: string;
  @ApiProperty() invoice_count!: number;
}

export class DailyRevenueReportDto {
  @ApiProperty({ type: [DailyRevenueRowDto] })
  rows!: DailyRevenueRowDto[];
}
