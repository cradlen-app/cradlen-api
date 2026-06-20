import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PatientVisitItemDto } from './patient-visit.dto.js';

/** One episode in a patient's journey, with its completed visits nested under it. */
export class PatientJourneyTimelineEpisodeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'Ordinal position within the journey' })
  order!: number;

  @ApiProperty({ description: 'ACTIVE | COMPLETED | CANCELLED' })
  status!: string;

  @ApiPropertyOptional({ nullable: true })
  started_at!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  ended_at!: Date | null;

  @ApiProperty({ type: [PatientVisitItemDto] })
  visits!: PatientVisitItemDto[];
}

/** One patient journey, with its episodes (each carrying their completed visits). */
export class PatientJourneyTimelineDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    description: 'Display name from the journey template, e.g. "Pregnancy"',
  })
  name!: string;

  @ApiProperty({ description: 'Journey template type, e.g. "OBGYN_PREGNANCY"' })
  type!: string;

  @ApiProperty({ description: 'ACTIVE | COMPLETED | CANCELLED' })
  status!: string;

  @ApiProperty()
  started_at!: Date;

  @ApiPropertyOptional({ nullable: true })
  ended_at!: Date | null;

  @ApiProperty({ type: [PatientJourneyTimelineEpisodeDto] })
  episodes!: PatientJourneyTimelineEpisodeDto[];
}
