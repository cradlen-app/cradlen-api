import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { MatchesField } from '@common/validators/matches-field.validator.js';
import { IsStrongPassword } from '@common/validators/strong-password.validator.js';
import { SECURITY_QUESTION_KEYS } from './security-questions.constant.js';

export class PatientSignupCompleteDto {
  @ApiProperty({ description: 'Token issued by signup/start' })
  @IsString()
  patient_signup_token!: string;

  @ApiProperty({ example: 'Password1!' })
  @IsStrongPassword()
  password!: string;

  @ApiProperty({ example: 'Password1!' })
  @IsString()
  @MaxLength(128)
  @MatchesField('password')
  confirm_password!: string;

  @ApiProperty({
    enum: SECURITY_QUESTION_KEYS,
    description: 'Chosen security question (for password recovery)',
  })
  @IsString()
  @IsIn(SECURITY_QUESTION_KEYS)
  security_question!: string;

  @ApiProperty({
    example: 'Cairo',
    description: 'Answer to the chosen security question',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(128)
  security_answer!: string;
}
