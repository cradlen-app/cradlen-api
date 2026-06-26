import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class AdminSetPasswordDto {
  @ApiProperty({ example: 'admin@cradlen.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;

  @ApiProperty({
    description: 'Single-use invite token from the emailed link.',
  })
  @IsString()
  @MinLength(1)
  token!: string;

  @ApiProperty({ description: 'New password (min 8 chars).' })
  @IsString()
  @MinLength(8)
  password!: string;
}
