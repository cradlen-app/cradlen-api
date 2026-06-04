import { ApiProperty } from '@nestjs/swagger';

export class PatientSignupStartResponseDto {
  @ApiProperty({
    description: 'Short-lived token to present at signup/complete',
  })
  patient_signup_token!: string;

  @ApiProperty({
    example: 1800,
    description: 'Seconds until the token expires',
  })
  expires_in!: number;
}
