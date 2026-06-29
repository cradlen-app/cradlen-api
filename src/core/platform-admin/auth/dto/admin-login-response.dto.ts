import { ApiProperty } from '@nestjs/swagger';

export class AdminLoginResponseDto {
  @ApiProperty({
    example: true,
    description:
      'Always true on success: credentials accepted, a login code was emailed. Complete login via POST /v1/admin/auth/verify-otp.',
  })
  otp_required!: boolean;
}
