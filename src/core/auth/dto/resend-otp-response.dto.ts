import { ApiProperty } from '@nestjs/swagger';

export class ResendOtpResponseDto {
  @ApiProperty({ example: true })
  success!: true;
}
