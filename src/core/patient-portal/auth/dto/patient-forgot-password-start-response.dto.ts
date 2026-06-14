import { ApiProperty } from '@nestjs/swagger';
import { SECURITY_QUESTION_KEYS } from './security-questions.constant.js';

export class PatientForgotPasswordStartResponseDto {
  @ApiProperty({
    enum: SECURITY_QUESTION_KEYS,
    description: "The account's stored security question key",
  })
  security_question!: string;

  @ApiProperty({
    description: 'Short-lived token to present at forgot-password/complete',
  })
  reset_token!: string;

  @ApiProperty({
    example: 1800,
    description: 'Seconds until the reset token expires',
  })
  expires_in!: number;
}
