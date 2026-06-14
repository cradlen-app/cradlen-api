import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { SECURITY_QUESTION_KEYS } from './security-questions.constant.js';

/**
 * Sets or replaces the logged-in account's security question + answer from the
 * portal profile page. The current password gates the change so a hijacked
 * session can't silently swap the recovery credential. Only the question key is
 * stored; the answer is normalized + hashed (never returned to the client).
 */
export class SetSecurityQuestionDto {
  @ApiProperty({
    enum: SECURITY_QUESTION_KEYS,
    description: 'One of the canonical security-question keys.',
  })
  @IsString()
  @IsIn(SECURITY_QUESTION_KEYS)
  security_question!: string;

  @ApiProperty({
    description: 'The answer to the chosen question (2–128 chars).',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(128)
  security_answer!: string;

  @ApiProperty({ description: "The account's current password" })
  @IsString()
  current_password!: string;
}
