import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { MatchesField } from '@common/validators/matches-field.validator.js';
import { IsStrongPassword } from '@common/validators/strong-password.validator.js';

/**
 * Step 2 of patient password recovery: the reset token from step 1, the answer
 * to the account's security question, and the new password.
 */
export class PatientForgotPasswordCompleteDto {
  @ApiProperty({ description: 'Token issued by forgot-password/start' })
  @IsString()
  reset_token!: string;

  @ApiProperty({
    example: 'Cairo',
    description: 'Answer to the security question',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(128)
  security_answer!: string;

  @ApiProperty({ example: 'Password1!' })
  @IsStrongPassword()
  password!: string;

  @ApiProperty({ example: 'Password1!' })
  @IsString()
  @MaxLength(128)
  @MatchesField('password')
  confirm_password!: string;
}
