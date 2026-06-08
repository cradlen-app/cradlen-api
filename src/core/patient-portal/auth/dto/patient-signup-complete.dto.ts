import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { MatchesField } from '@common/validators/matches-field.validator.js';
import { IsStrongPassword } from '@common/validators/strong-password.validator.js';

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
}
