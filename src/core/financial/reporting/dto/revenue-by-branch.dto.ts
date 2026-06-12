import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RevenueByBranchRowDto {
  @ApiPropertyOptional({ description: 'Null when the invoice has no branch.' })
  branch_id!: string | null;
  @ApiProperty() branch_name!: string;
  @ApiProperty() invoice_count!: number;
  @ApiProperty({ description: 'Billed invoice revenue (string).' })
  billed!: string;
  @ApiProperty({ description: 'Collected amount (string).' })
  collected!: string;
  @ApiProperty({ description: 'Outstanding balance (string).' })
  outstanding!: string;
}

export class RevenueByBranchReportDto {
  @ApiProperty({ type: [RevenueByBranchRowDto] })
  by_branch!: RevenueByBranchRowDto[];
  @ApiProperty() total!: string;
}
