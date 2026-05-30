import { ApiProperty } from '@nestjs/swagger';

export class JobFunctionLookupDto {
  @ApiProperty({ example: 'OBGYN' })
  code!: string;

  @ApiProperty({ example: 'OBGYN' })
  name!: string;

  @ApiProperty({ example: true })
  is_clinical!: boolean;
}
