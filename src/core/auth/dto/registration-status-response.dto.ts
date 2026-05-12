import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type RegistrationStep =
  | 'NONE'
  | 'VERIFY_OTP'
  | 'COMPLETE_ONBOARDING'
  | 'DONE';

export class RegistrationStatusResponseDto {
  @ApiProperty({
    enum: ['NONE', 'VERIFY_OTP', 'COMPLETE_ONBOARDING', 'DONE'],
  })
  step!: RegistrationStep;

  @ApiPropertyOptional()
  email?: string;
}
