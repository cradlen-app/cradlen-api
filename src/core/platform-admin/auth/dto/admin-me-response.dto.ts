import { ApiProperty } from '@nestjs/swagger';

export class AdminMeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  full_name!: string;
}
