import { ApiProperty } from '@nestjs/swagger';
import { IsPhoneNumber, IsString, Matches } from 'class-validator';

export class RequestPhoneOtpDto {
  @ApiProperty()
  @IsPhoneNumber()
  phone_number!: string;
}

export class VerifyPhoneOtpDto {
  @ApiProperty()
  @IsPhoneNumber()
  phone_number!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}
