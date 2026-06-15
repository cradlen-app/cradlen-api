import { ApiProperty } from '@nestjs/swagger';
import { AddOnKind } from '@prisma/client';

/** An add-on the org may purchase on top of its current plan (YEARLY price). */
export class AvailableAddOnResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: AddOnKind })
  kind!: AddOnKind;

  @ApiProperty({ description: 'Branches this add-on grants per unit' })
  delta_branches!: number;

  @ApiProperty({ description: 'User seats this add-on grants per unit' })
  delta_users!: number;

  @ApiProperty({ description: 'Full yearly price as a decimal string' })
  price!: string;

  @ApiProperty()
  currency!: string;
}
