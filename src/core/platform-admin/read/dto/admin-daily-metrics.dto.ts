import { ApiProperty } from '@nestjs/swagger';

/**
 * One day in the admin engagement trend. `active_*` count distinct entities that
 * had an authenticated request that UTC day; `total_*` are the cumulative
 * registered counts as-of that day. Sourced from the `daily_metric_snapshots`
 * table; days with no snapshot are returned as zeros so the series is contiguous.
 */
export class AdminDailyMetricPointDto {
  @ApiProperty({ description: "UTC day as 'YYYY-MM-DD'." })
  date!: string;
  @ApiProperty({ description: 'Distinct staff active that day.' })
  active_staff!: number;
  @ApiProperty({ description: 'Total non-deleted staff as-of that day.' })
  total_staff!: number;
  @ApiProperty({ description: 'Distinct patient portals active that day.' })
  active_portals!: number;
  @ApiProperty({ description: 'Total patient-portal accounts as-of that day.' })
  total_portals!: number;
  @ApiProperty({ description: 'Distinct ACTIVE enrollments as-of that day.' })
  total_enrolled_patients!: number;
}
