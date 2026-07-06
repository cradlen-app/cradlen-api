import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MinLength } from 'class-validator';

export class AnonymizePatientDto {
  @ApiProperty({
    description: 'The organization (controller) whose erasure request this is.',
  })
  @IsUUID()
  organization_id!: string;

  @ApiProperty({
    description: 'Documented reason / controller instruction (min 8 chars).',
  })
  @IsString()
  @MinLength(8)
  reason!: string;
}

export class AnonymizeResultDto {
  @ApiProperty()
  patient_id!: string;

  @ApiProperty({
    description:
      'True when the shared master identity was scrubbed (the requesting org was the last one holding this patient).',
  })
  master_anonymized!: boolean;

  @ApiProperty({
    description:
      'True when other organizations still hold this patient — only the requesting org’s data was removed.',
  })
  other_orgs_remain!: boolean;
}
