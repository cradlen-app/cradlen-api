import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Patient-portal history is delivered **display-ready**: the backend composes
 * the clinician OB/GYN history into labeled rows so the portal renders a single
 * generic collapsible accordion with no per-field mapping. The hierarchy is
 * group → section → entry → row, designed so additional history types (cardiac,
 * pediatric, …) surface later as new groups with no frontend change.
 */
export class PortalHistoryRowDto {
  @ApiProperty({ description: 'Field label, e.g. "Age at menarche"' })
  label!: string;

  @ApiProperty({ description: 'Already-formatted display value' })
  value!: string;
}

export class PortalHistoryEntryDto {
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Heading for a repeatable record (e.g. a pregnancy); null for singleton sections',
  })
  title!: string | null;

  @ApiProperty({ type: [PortalHistoryRowDto] })
  rows!: PortalHistoryRowDto[];
}

export class PortalHistorySectionDto {
  @ApiProperty({ description: 'Stable section code, e.g. "menstrual_history"' })
  code!: string;

  @ApiProperty({ description: 'Section title, e.g. "Menstrual History"' })
  label!: string;

  @ApiProperty({ type: [PortalHistoryEntryDto] })
  entries!: PortalHistoryEntryDto[];
}

export class PortalHistoryGroupDto {
  @ApiProperty({ description: 'Stable history-type code, e.g. "OBGYN"' })
  code!: string;

  @ApiProperty({ description: 'History-type title, e.g. "OB/GYN History"' })
  label!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Optimistic-concurrency version of the underlying record',
  })
  version!: number | null;

  @ApiProperty({ type: [PortalHistorySectionDto] })
  sections!: PortalHistorySectionDto[];
}

export class PortalHistoryResponseDto {
  @ApiProperty()
  patient_id!: string;

  @ApiProperty({
    type: [PortalHistoryGroupDto],
    description: 'Empty when the patient has no recorded history',
  })
  groups!: PortalHistoryGroupDto[];
}
