import { ApiProperty } from '@nestjs/swagger';

/**
 * The optional clinical surface a care path declares (from
 * CarePathClinicalSurface). Present → the workspace renders one journey tab
 * backed by `template_code`; absent → no extra tab.
 */
export class JourneyClinicalSurfaceDto {
  @ApiProperty({ example: 'obgyn_pregnancy' })
  template_code!: string;

  @ApiProperty({ example: 'Pregnancy' })
  label!: string;
}

/**
 * Descriptor for the journey a visit belongs to (the patient's single active
 * journey for a live visit). Drives the dynamic journey tab in the visit
 * workspace. `clinical_surface` is null when the journey's care path declares
 * no surface — the frontend then renders no extra tab.
 */
export class JourneyDescriptorDto {
  @ApiProperty({ format: 'uuid' })
  journey_id!: string;

  @ApiProperty({ format: 'uuid' })
  episode_id!: string;

  @ApiProperty({ nullable: true, example: 'OBGYN_PREGNANCY' })
  care_path_code!: string | null;

  @ApiProperty({ nullable: true, example: 'OBGYN' })
  specialty_code!: string | null;

  @ApiProperty({
    nullable: true,
    example: 'Pregnancy',
    description: 'Care path display name',
  })
  label!: string | null;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  started_at!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  ended_at!: Date | null;

  @ApiProperty({ type: JourneyClinicalSurfaceDto, nullable: true })
  clinical_surface!: JourneyClinicalSurfaceDto | null;
}
