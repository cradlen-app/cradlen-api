import { ApiProperty } from '@nestjs/swagger';

export class RoleResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id!: string;

  @ApiProperty({ example: 'OWNER' })
  code!: string;

  @ApiProperty({ example: 'OWNER' })
  name!: string;
}
