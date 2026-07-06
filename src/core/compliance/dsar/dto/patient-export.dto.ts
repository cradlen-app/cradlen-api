import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Data-subject-access / portability bundle for one patient, scoped to the
 * requesting organization. Nested clinical/consent records are passed through
 * as-stored (typed loosely here — the export is a faithful data dump, not a
 * curated view).
 */
export class PatientExportDto {
  @ApiProperty()
  generated_at!: Date;

  @ApiProperty({ description: 'The organization the export is scoped to.' })
  organization_id!: string;

  @ApiPropertyOptional({ type: Object, nullable: true })
  patient!: Record<string, unknown> | null;

  @ApiProperty({ type: [Object], description: 'Journeys → episodes → visits.' })
  journeys!: unknown[];

  @ApiPropertyOptional({ type: Object, nullable: true })
  obgyn_history!: unknown;

  @ApiProperty({ type: [Object] })
  consents!: unknown[];
}
