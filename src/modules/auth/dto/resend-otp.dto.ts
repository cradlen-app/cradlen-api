import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ResendOtpDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  registration_token!: string;
}
