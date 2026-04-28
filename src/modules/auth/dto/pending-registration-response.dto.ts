import { ApiProperty } from '@nestjs/swagger';

export class PendingRegistrationResponseDto {
  @ApiProperty({ enum: ['pending'] })
  type!: 'pending';

  @ApiProperty()
  registration_token!: string;

  @ApiProperty({ example: 1800, description: 'Seconds until token expires' })
  expires_in!: number;

  @ApiProperty({
    enum: ['verify_email', 'organization'],
    description: 'Which registration step to resume',
  })
  pending_step!: 'verify_email' | 'organization';
}
