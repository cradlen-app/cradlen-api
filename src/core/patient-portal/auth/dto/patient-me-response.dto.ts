import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PatientSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  full_name!: string;

  @ApiProperty({ description: 'ISO date (YYYY-MM-DD)' })
  date_of_birth!: string;

  @ApiProperty({
    description:
      '"SELF" for the account holder\'s own record, otherwise the GuardianRelation value (PARENT, CHILD, …).',
  })
  relation!: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "Short-lived presigned GET URL for the patient's avatar, or null.",
  })
  profile_image_url!: string | null;
}

export class PatientMeResponseDto {
  @ApiProperty()
  user_id!: string;

  @ApiPropertyOptional({ nullable: true })
  patient_id!: string | null;

  @ApiPropertyOptional({ nullable: true })
  guardian_id!: string | null;

  @ApiProperty({ type: [String] })
  accessible_patient_ids!: string[];

  @ApiProperty({ description: "The account holder's full name." })
  display_name!: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The account security-question key (e.g. BIRTH_CITY), or null if none is set. The answer is never returned.',
  })
  security_question!: string | null;

  @ApiProperty({ type: [PatientSummaryDto] })
  accessible_patients!: PatientSummaryDto[];
}
