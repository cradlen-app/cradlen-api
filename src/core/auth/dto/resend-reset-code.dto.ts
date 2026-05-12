import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ResendResetCodeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  reset_token!: string;
}
