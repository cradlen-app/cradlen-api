import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CashSessionStatus } from '@prisma/client';
import { CashDrawerSummaryDto } from './cash-drawer-summary.dto.js';

/** A cash drawer session. Monetary columns serialize as strings. */
export class CashSessionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() organization_id!: string;
  @ApiProperty() branch_id!: string;
  @ApiProperty() profile_id!: string;
  @ApiProperty() opening_float!: string;
  @ApiProperty() opened_by_id!: string;
  @ApiProperty() opened_at!: Date;
  @ApiPropertyOptional() closed_by_id!: string | null;
  @ApiPropertyOptional() closed_at!: Date | null;
  @ApiPropertyOptional() expected_amount!: string | null;
  @ApiPropertyOptional() counted_amount!: string | null;
  @ApiPropertyOptional() variance!: string | null;
  @ApiProperty({ enum: CashSessionStatus }) status!: CashSessionStatus;
  @ApiPropertyOptional() notes!: string | null;
  @ApiProperty() created_at!: Date;
  @ApiProperty() updated_at!: Date;

  @ApiPropertyOptional({
    type: CashDrawerSummaryDto,
    description: 'Live drawer state — present only for OPEN sessions.',
  })
  summary?: CashDrawerSummaryDto;
}
