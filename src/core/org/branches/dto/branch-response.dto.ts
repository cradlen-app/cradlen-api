import { ApiProperty } from '@nestjs/swagger';
import type { BranchStatus } from '@prisma/client';

export class BranchResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  address!: string;

  @ApiProperty()
  city!: string;

  @ApiProperty()
  governorate!: string;

  @ApiProperty({ nullable: true })
  country!: string | null;

  @ApiProperty()
  is_main!: boolean;

  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] })
  status!: BranchStatus;

  @ApiProperty()
  created_at!: Date;

  @ApiProperty()
  updated_at!: Date;
}
