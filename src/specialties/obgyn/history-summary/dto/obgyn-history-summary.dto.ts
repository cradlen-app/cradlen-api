import { ApiProperty } from '@nestjs/swagger';

export type SummarySignalSeverity = 'high' | 'medium' | 'low' | 'positive';
export type SummarySectionStatus = 'positive' | 'negative' | 'unknown';

export class GtpalDto {
  @ApiProperty() g!: number;
  @ApiProperty() t!: number;
  @ApiProperty() p!: number;
  @ApiProperty() a!: number;
  @ApiProperty() l!: number;
}

export class HistorySummaryIdentifierDto {
  @ApiProperty({ nullable: true }) age!: number | null;
  @ApiProperty({ type: GtpalDto, nullable: true }) gtpal!: GtpalDto | null;
  @ApiProperty({ nullable: true, example: 'G3 T2 P0 A1 L2' })
  gtpal_label!: string | null;
  @ApiProperty({ nullable: true }) lmp!: string | null;
}

export class HistorySummarySectionDto {
  @ApiProperty({ example: 'pmhx' }) code!: string;
  @ApiProperty({ example: 'Past medical history' }) label!: string;
  @ApiProperty({ type: [String] }) items!: string[];
  @ApiProperty({ enum: ['positive', 'negative', 'unknown'] })
  status!: SummarySectionStatus;
}

export class HistorySummaryFlagDto {
  @ApiProperty() label!: string;
  @ApiProperty({ enum: ['high', 'medium', 'low', 'positive'] })
  severity!: SummarySignalSeverity;
}

/**
 * Canonical, server-computed "standard history summary": a GTPAL identifier
 * line + problem-oriented sections (with pertinent negatives) + prioritized
 * flags + an assembled narrative. Reusable across the workspace rail,
 * referrals, PDFs, and AI context.
 */
export class ObgynHistorySummaryDto {
  @ApiProperty() history_exists!: boolean;
  @ApiProperty({ type: HistorySummaryIdentifierDto })
  identifier!: HistorySummaryIdentifierDto;
  @ApiProperty({ type: [HistorySummarySectionDto] })
  sections!: HistorySummarySectionDto[];
  @ApiProperty({ type: [HistorySummaryFlagDto] })
  flags!: HistorySummaryFlagDto[];
  @ApiProperty() narrative!: string;
}
