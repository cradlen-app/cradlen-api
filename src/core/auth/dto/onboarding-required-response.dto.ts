import { ApiProperty } from '@nestjs/swagger';

/**
 * Returned by `POST /auth/login` when the credentials are valid but the user
 * has not finished registration. For `COMPLETE_ONBOARDING` a fresh
 * `signup_token` is included so the client can resume onboarding directly
 * (the password was just verified, so issuing it here is safe).
 */
export class OnboardingRequiredResponseDto {
  @ApiProperty({ enum: ['ONBOARDING_REQUIRED'] })
  type!: 'ONBOARDING_REQUIRED';

  @ApiProperty({ enum: ['VERIFY_OTP', 'COMPLETE_ONBOARDING'] })
  step!: 'VERIFY_OTP' | 'COMPLETE_ONBOARDING';

  @ApiProperty({
    required: false,
    description: 'Present only for COMPLETE_ONBOARDING — resume onboarding token',
  })
  signup_token?: string;

  @ApiProperty({
    required: false,
    example: 1800,
    description: 'Seconds until the signup_token expires',
  })
  expires_in?: number;
}
