import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  first_name!: string;

  @ApiProperty()
  last_name!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  is_active!: boolean;

  @ApiPropertyOptional({ nullable: true })
  verified_at!: Date | null;

  @ApiProperty()
  created_at!: Date;
}
