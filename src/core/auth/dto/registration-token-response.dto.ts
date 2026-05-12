import { ApiProperty } from '@nestjs/swagger';

export class RegistrationTokenResponseDto {
  @ApiProperty()
  registration_token!: string;

  @ApiProperty({ example: 1800, description: 'Seconds until token expires' })
  expires_in!: number;
}
