import { ApiProperty } from '@nestjs/swagger';

export class ResetTokenResponseDto {
  @ApiProperty()
  reset_token!: string;

  @ApiProperty({ example: 1800, description: 'Seconds until token expires' })
  expires_in!: number;
}
