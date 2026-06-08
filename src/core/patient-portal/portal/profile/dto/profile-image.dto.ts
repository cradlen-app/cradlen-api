import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ProfileImageUploadDto {
  @ApiProperty({
    description: 'MIME type, e.g. image/png, image/jpeg, image/webp',
  })
  @IsString()
  content_type!: string;

  @ApiProperty({ description: 'File size in bytes' })
  @IsInt()
  @Min(1)
  size_bytes!: number;

  @ApiPropertyOptional({
    description: 'Original file name (for reference only)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  file_name?: string;
}

export class ProfileImageUploadUrlDto {
  @ApiProperty({
    description: 'Server-derived object key to confirm with later',
  })
  key!: string;

  @ApiProperty({
    description: 'Short-lived presigned PUT URL — upload the bytes here',
  })
  upload_url!: string;

  @ApiProperty({ description: 'Seconds until the upload URL expires' })
  expires_in!: number;

  @ApiProperty({ description: 'Content-Type the PUT must send' })
  content_type!: string;
}

export class ConfirmProfileImageDto {
  @ApiProperty({ description: 'The key returned by the upload-url endpoint' })
  @IsString()
  key!: string;
}
