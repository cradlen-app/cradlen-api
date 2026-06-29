import { ApiProperty } from '@nestjs/swagger';
import { SummarySignalSeverity } from '../../history-summary/dto/obgyn-history-summary.dto';

export class CurrentEpisodeDto {
  @ApiProperty() name!: string;
  @ApiProperty() order!: number;
  @ApiProperty({ example: 'ACTIVE' }) status!: string;
}

/** Generic clinical gist of the journey's latest visit (the primary content for
 *  non-surface care paths like General GYN). */
export class JourneyEncounterDto {
  @ApiProperty({ nullable: true }) chief_complaint!: string | null;
  @ApiProperty({ nullable: true }) provisional_diagnosis!: string | null;
}

/** Pregnancy-specific at-a-glance identifier (null for non-pregnancy journeys). */
export class JourneyIdentifierDto {
  @ApiProperty({ nullable: true, example: '24w 3d' }) ga!: string | null;
  @ApiProperty({ nullable: true, enum: ['US', 'LMP'] })
  ga_source!: 'US' | 'LMP' | null;
  @ApiProperty({ nullable: true, example: '2026-10-08' }) edd!: string | null;
  @ApiProperty({ nullable: true }) lmp!: string | null;
  @ApiProperty({ nullable: true }) risk_level!: string | null;
  @ApiProperty({ nullable: true }) pregnancy_type!: string | null;
  @ApiProperty({ nullable: true }) number_of_fetuses!: number | null;
  @ApiProperty({ nullable: true, example: 'A+' }) blood_group_rh!:
    | string
    | null;
}

export class JourneySummaryFlagDto {
  @ApiProperty() label!: string;
  @ApiProperty({ enum: ['high', 'medium', 'low', 'positive'] })
  severity!: SummarySignalSeverity;
}

/**
 * Server-curated summary of the patient's CURRENT active journey (else the
 * most-recent completed one). Generic header for any care path + an `encounter`
 * gist; pregnancy journeys add the GA/EDD/risk `identifier`, outcome, and flags.
 * Mirrors the OB/GYN history summary; rendered as the Overview "Current journey"
 * card.
 */
export class ActiveJourneySummaryDto {
  @ApiProperty() journey_exists!: boolean;
  @ApiProperty({ nullable: true }) journey_id!: string | null;
  @ApiProperty({ nullable: true, example: 'OBGYN_PREGNANCY' })
  care_path_code!: string | null;
  @ApiProperty({ nullable: true, example: 'Pregnancy' })
  care_path_label!: string | null;
  @ApiProperty({ nullable: true, example: 'ACTIVE' }) status!: string | null;
  @ApiProperty() is_active!: boolean;
  @ApiProperty({ nullable: true }) started_at!: string | null;
  @ApiProperty({ nullable: true }) ended_at!: string | null;
  @ApiProperty({ type: CurrentEpisodeDto, nullable: true })
  current_episode!: CurrentEpisodeDto | null;
  @ApiProperty({ type: JourneyEncounterDto, nullable: true })
  encounter!: JourneyEncounterDto | null;
  @ApiProperty({ type: JourneyIdentifierDto, nullable: true })
  identifier!: JourneyIdentifierDto | null;
  @ApiProperty({ nullable: true, type: Object })
  outcome!: Record<string, unknown> | null;
  @ApiProperty({ type: [JourneySummaryFlagDto] })
  flags!: JourneySummaryFlagDto[];
  @ApiProperty() narrative!: string;
}
