import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ description: "The account's current password" })
  @IsString()
  current_password!: string;

  @ApiProperty({ description: 'The new password (min 8 chars)' })
  @IsString()
  @MinLength(8)
  new_password!: string;
}
