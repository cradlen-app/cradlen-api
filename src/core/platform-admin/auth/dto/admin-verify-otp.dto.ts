import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length } from 'class-validator';

export class AdminVerifyOtpDto {
  @ApiProperty({ example: 'admin@cradlen.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;

  @ApiProperty({ example: '123456', description: '6-digit login code' })
  @IsString()
  @Length(6, 6)
  code!: string;
}
