import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsPositive, IsString } from 'class-validator';

export class CreateProofUploadDto {
  @ApiProperty({ description: 'MIME type of the proof file (image or PDF)' })
  @IsString()
  @IsNotEmpty()
  content_type!: string;

  @ApiProperty({ description: 'Size of the file in bytes' })
  @IsInt()
  @IsPositive()
  size_bytes!: number;
}

export class ProofUploadUrlDto {
  @ApiProperty({ description: 'Server-derived object key to confirm later' })
  key!: string;

  @ApiProperty({
    description: 'Short-lived presigned PUT URL — upload the bytes here',
  })
  upload_url!: string;

  @ApiProperty()
  expires_in!: number;

  @ApiProperty()
  content_type!: string;
}

export class ConfirmProofDto {
  @ApiProperty({
    description: 'The object key returned by the upload-url step',
  })
  @IsString()
  @IsNotEmpty()
  key!: string;
}
