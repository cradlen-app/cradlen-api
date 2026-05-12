import { ApiProperty } from '@nestjs/swagger';

export class SignupTokenResponseDto {
  @ApiProperty()
  signup_token!: string;

  @ApiProperty({ example: 1800, description: 'Seconds until token expires' })
  expires_in!: number;
}
